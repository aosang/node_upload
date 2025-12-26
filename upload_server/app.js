import express from 'express'
import cors from 'cors'
import path from 'path'
import fs from 'fs-extra'
import multer from 'multer'
import { fileURLToPath } from 'url'
import { dirname } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const app = express()
app.use(cors())

const upload_dir = path.resolve(__dirname, 'uploads')
fs.ensureDirSync(upload_dir)

// 配置静态文件访问，使 /uploads 路径可以访问到 uploads 文件夹
app.use('/uploads', express.static(upload_dir))

// 配置 multer 存储
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, upload_dir)
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname)
    const basename = path.basename(file.originalname, ext)
    cb(null, `${basename}-${Date.now()}${ext}`)
  }
})

const upload = multer({ storage: storage })

app.use(express.json())

// 分块上传临时目录
const temp_dir = path.resolve(__dirname, 'temp_chunks')
fs.ensureDirSync(temp_dir)

// 已完成上传的标记目录（避免重复上传）
// 注意：放在 temp_chunks 外部，避免被清理
const completed_dir = path.resolve(__dirname, 'upload_completed')
fs.ensureDirSync(completed_dir)
console.log(`完成标记目录: ${completed_dir}`)

// 上传单个分块（简化版）
app.post('/upload-chunk', upload.single('chunk'), (req, res) => {
  try {
    const { filename, fileId, chunkNumber, totalChunks } = req.body
    
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: '未接收到分块文件'
      })
    }
    
    // 使用 fileId 创建分块目录
    const chunkDir = path.resolve(temp_dir, fileId)
    fs.ensureDirSync(chunkDir)
    
    // 保存分块文件
    const chunkPath = path.resolve(chunkDir, `chunk-${chunkNumber}`)
    fs.moveSync(req.file.path, chunkPath, { overwrite: true })
    
    console.log(`已接收: ${filename} 分块 ${chunkNumber}/${totalChunks}`)
    
    res.json({
      success: true,
      message: `分块 ${chunkNumber} 上传成功`
    })
  } catch (error) {
    console.error(`分块上传失败: ${error.message}`)
    res.status(500).json({
      success: false,
      message: '分块上传失败',
      error: error.message
    })
  }
})

// 合并分块（简化版）
app.post('/merge-chunks', async (req, res) => {
  try {
    const { filename, fileId, totalChunks } = req.body
    const chunkDir = path.resolve(temp_dir, fileId)
    const completedFlag = path.resolve(completed_dir, fileId)
    
    console.log(`开始合并: ${filename} (共 ${totalChunks} 块)`)
    console.log(`分块目录: ${chunkDir}`)
    console.log(`完成标记: ${completedFlag}`)
    
    // 🎯 优先检查：该文件是否已经完成过（避免重复上传）
    if (fs.existsSync(completedFlag)) {
      try {
        const savedFilename = await fs.readFile(completedFlag, 'utf-8')
        const actualFilePath = path.resolve(upload_dir, savedFilename)
        
        // 🔍 关键检查：验证实际文件是否真实存在
        if (fs.existsSync(actualFilePath)) {
          console.log(`✓ 文件 ${filename} 已存在，跳过重复上传`)
          console.log(`  实际文件: ${savedFilename}`)
          return res.json({
            success: true,
            message: '文件已上传（跳过重复）',
            filename: savedFilename
          })
        } else {
          // ⚠️ 标记文件存在，但实际文件不存在（可能被删除）
          console.log(`⚠️ 标记存在但文件不存在: ${savedFilename}`)
          console.log(`  删除无效标记，重新上传`)
          await fs.remove(completedFlag)
          // 继续执行后续的合并流程
        }
      } catch (readError) {
        console.error(`读取完成标记失败: ${readError.message}`)
        // 如果读取失败，删除损坏的标记文件，继续合并流程
        await fs.remove(completedFlag)
      }
    }
    
    // 检查分块目录是否存在
    if (!fs.existsSync(chunkDir)) {
      console.log(`❌ 分块目录不存在: ${fileId}`)
      return res.status(400).json({
        success: false,
        message: '分块目录不存在，请重新上传'
      })
    }
    
    // 生成最终文件名
    const ext = path.extname(filename)
    const basename = path.basename(filename, ext)
    const finalFileName = `${basename}-${Date.now()}${ext}`
    const finalFilePath = path.resolve(upload_dir, finalFileName)
    
    // 创建写入流，按顺序合并分块
    const writeStream = fs.createWriteStream(finalFilePath)
    
    for (let i = 0; i < totalChunks; i++) {
      const chunkPath = path.resolve(chunkDir, `chunk-${i}`)
      
      // 检查分块是否存在
      if (!fs.existsSync(chunkPath)) {
        writeStream.close()
        return res.status(400).json({
          success: false,
          message: `分块 ${i} 不存在，请重新上传`
        })
      }
      
      // 读取并写入分块
      const chunkBuffer = await fs.readFile(chunkPath)
      writeStream.write(chunkBuffer)
    }
    
    writeStream.end()
    
    // 等待写入完成
    await new Promise((resolve, reject) => {
      writeStream.on('finish', resolve)
      writeStream.on('error', reject)
    })
    
    // 删除临时分块目录
    await fs.remove(chunkDir)
    
    // 🎯 创建完成标记（保存最终文件名，避免重复上传）
    try {
      // 确保 .completed 目录存在
      await fs.ensureDir(completed_dir)
      await fs.writeFile(completedFlag, finalFileName, 'utf-8')
      console.log(`✓ 创建完成标记: ${fileId}`)
    } catch (flagError) {
      // 标记创建失败不影响主流程，仅记录日志
      console.error(`⚠️ 创建完成标记失败: ${flagError.message}`)
    }
    
    console.log(`合并成功: ${finalFileName}`)
    
    res.json({
      success: true,
      message: '文件上传成功',
      filename: finalFileName
    })
  } catch (error) {
    console.error(`文件合并失败: ${error.message}`)
    res.status(500).json({
      success: false,
      message: '文件合并失败',
      error: error.message
    })
  }
})

// 上传图片文件接口（保留原有接口）
app.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({
      success: false,
      message: 'No file uploaded'
    })
  }
  res.json({
    success: true,
    message: 'File uploaded successfully',
    filePath: req.file.path,
    filename: req.file.filename
  })
})

app.listen(3000, () => {
  console.log('Server is running on port 3000')
})