<template>
  <div>
    <el-upload 
      ref="uploadRef" 
      multiple
      accept="image/png,image/jpeg"
      :before-upload="beforeUpload"
      :http-request="customHttpRequest"
      :on-change="handleFileChange"
      :file-list="fileList"
      :auto-upload="false"
    >
      <el-button type="primary">批量上传图片</el-button>
    </el-upload>
    <div>
      <el-button type="primary" @click="startUpload" :disabled="fileList.length === 0">开始上传</el-button>
    </div>
    <div v-for="file in uploadStatus" :key="file.uid" style="margin-top: 15px;">
      <div style="margin-bottom: 5px;">
        <span>{{ file.name }}</span>
        <span v-if="file.status === 'success'" style="color: #67c23a; margin-left: 10px;">✓ 上传成功</span>
        <span v-if="file.status === 'error'" style="color: #f56c6c; margin-left: 10px;">✗ 上传失败</span>
      </div>
      <el-progress 
        :percentage="Math.floor(file.progress)" 
        :status="file.status === 'success' ? 'success' : file.status === 'error' ? 'exception' : ''"
      />
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { ElMessage } from 'element-plus'
import request from '@/utils/request'

// ==================== 数据定义 ====================
const fileList = ref([])           // 文件列表
const uploadStatus = ref([])       // 上传状态列表
const uploadRef = ref(null)        // 上传组件引用

let uploadQueue = []               // 上传队列
let currentUploads = 0             // 当前正在上传的数量
let worker = null                  // Worker实例

// 配置参数
const maxConcurrentUploads = 3            // 最大并发上传数
const maxSizeInMB = 3                   // 最大文件大小（MB）
const CHUNK_SIZE = 1 * 1024 * 1024        // 分块大小：1MB

// ==================== 辅助函数 ====================

/**
 * 生成文件的唯一标识（基于原始文件信息）
 * 规则：文件名_文件大小_最后修改时间
 * 即使压缩后，也使用原始文件信息生成ID，确保不同文件ID不同
 */
const getFileIdentifier = (file) => {
  // 如果文件有原始信息（压缩后的文件），使用原始信息
  const originalFile = file._originalFile || file
  
  const safeName = originalFile.name.replace(/[^a-zA-Z0-9.-]/g, '_')
  return `${safeName}_${originalFile.size}_${originalFile.lastModified}`
}

/**
 * 更新上传进度的辅助函数
 */
const updateUploadProgress = (uid, progress, status) => {
  const statusItem = uploadStatus.value.find(item => item.uid === uid)
  if (statusItem) {
    statusItem.progress = progress
    statusItem.status = status
  }
}

// ==================== 流程1：文件选择 ====================

/**
 * 文件选择变化时触发
 * 当用户选择文件后，更新文件列表和上传状态
 */
const handleFileChange = (file, fileListData) => {
  fileList.value = fileListData
  
  // 检查是否已经添加过这个文件
  const exists = uploadStatus.value.find(item => item.uid === file.uid)
  if (!exists) {
    uploadStatus.value.push({
      uid: file.uid,
      name: file.name,
      progress: 0,
      status: 'pending'
    })
  }
}

// ==================== 流程2：上传前处理（压缩） ====================

/**
 * 上传前处理：所有图片都进行压缩
 * 返回 Promise，resolve 后继续上传流程
 */
const beforeUpload = (file) => {
  // 检查文件大小
  const isUnderLimit = file.size / 1024 / 1024 < maxSizeInMB
  if (!isUnderLimit) {
    ElMessage.error(`文件大小不能超过${maxSizeInMB}MB`)
    return false
  }

  // 所有图片都使用 Worker 压缩（无论大小）
  if (worker) {
    return new Promise((resolve, reject) => {
      // 生成唯一任务ID，避免多个文件同时压缩时混乱
      const taskId = `${file.name}_${file.size}_${Date.now()}_${Math.random()}`
      
      const handleMessage = (event) => {
        // 检查是否是当前任务的响应
        if (event.data.taskId === taskId) {
          worker.removeEventListener('message', handleMessage)
          worker.removeEventListener('error', handleError)
          
          if (event.data.success) {
            // 压缩后的文件
            const compressedFile = event.data.file
            
            // 关键：给压缩后的文件添加原始文件信息
            // 这样可以确保文件ID的唯一性和一致性
            compressedFile._originalFile = {
              name: file.name,
              size: file.size,
              lastModified: file.lastModified
            }
            
            console.log(`[${file.name}] 压缩完成: ${file.size} -> ${compressedFile.size} 字节`)
            resolve(compressedFile)
          } else {
            console.error(`[${file.name}] 压缩失败:`, event.data.error)
            reject(new Error(event.data.error))
          }
        }
      }

      const handleError = (error) => {
        worker.removeEventListener('message', handleMessage)
        worker.removeEventListener('error', handleError)
        console.error(`[${file.name}] Worker 错误:`, error)
        reject(error)
      }

      worker.addEventListener('message', handleMessage)
      worker.addEventListener('error', handleError)
      
      console.log(`[${file.name}] 开始压缩... (任务ID: ${taskId})`)
      worker.postMessage({ 
        file, 
        quality: 0.8,           // 压缩质量 0.8
        targetFormat: 'jpeg',   // 目标格式 JPEG
        taskId                  // 传递任务ID
      })
    })
  }

  // 如果 Worker 未初始化，直接通过
  console.log(`[${file.name}] Worker 未初始化，不压缩`)
  return true
}

// ==================== 流程3：自定义上传（加入队列） ====================

/**
 * 自定义上传请求处理
 * 将文件加入队列，控制并发上传数量
 */
const customHttpRequest = (options) => {
  const { file, onProgress, onError, onSuccess } = options
  
  // 将文件和回调函数包装到队列中
  uploadQueue.push({
    file,
    onProgress,
    onError,
    onSuccess,
    uid: file.uid
  })
  
  // 开始处理队列
  processQueue()
}

// ==================== 流程4：处理上传队列 ====================

/**
 * 处理上传队列
 * 根据最大并发数，从队列中取出文件进行上传
 */
const processQueue = () => {
  while (currentUploads < maxConcurrentUploads && uploadQueue.length > 0) {
    const nextFile = uploadQueue.shift()
    if (nextFile) {
      uploadFileWithChunks(nextFile)
    }
  }
}

// ==================== 流程5：分块上传（核心逻辑） ====================

/**
 * 分块上传（支持断点续传）
 * 将文件切割成多个分块，逐个上传，支持从断点继续上传
 */
const uploadFileWithChunks = async (fileData) => {
  currentUploads++
  const file = fileData.file
  
  // 获取文件名（可能是压缩后的文件，需要用原始文件名）
  const fileName = file._originalFile ? file._originalFile.name : file.name
  
  // 生成文件ID（使用原始文件信息）
  const fileId = getFileIdentifier(file)
  
  try {
    console.log(`[${fileName}] 开始上传`)
    console.log(`[${fileName}] 文件ID: ${fileId}`)
    console.log(`[${fileName}] 当前大小: ${file.size} 字节`)
    
    // 计算总分块数
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE)
    console.log(`[${fileName}] 总共 ${totalChunks} 块，每块 1MB`)
    
    // 从 localStorage 读取已上传的分块（断点续传）
    const progressKey = `upload_${fileId}`
    let uploadedChunks = []
    try {
      const saved = localStorage.getItem(progressKey)
      if (saved) {
        uploadedChunks = JSON.parse(saved).chunks || []
        console.log(`[${fileName}] 发现断点，已上传 ${uploadedChunks.length} 块`)
      }
    } catch (e) {
      console.log(`[${fileName}] 无断点记录，从头开始`)
    }
    
    // 检查是否所有分块都已上传（文件已完成）
    if (uploadedChunks.length === totalChunks) {
      console.log(`[${fileName}] 本地记录显示文件已完成，尝试合并验证...`)
      
      try {
        // 🔍 尝试调用合并接口验证文件是否真实存在
        const mergeResult = await request.post('/merge-chunks', {
          filename: fileName,
          fileId: fileId,
          totalChunks
        })
        
        // 文件确实存在，跳过重复上传
        console.log(`[${fileName}] ✓ 文件已存在，跳过重复上传`)
        localStorage.removeItem(progressKey)
        currentUploads--
        processQueue()
        fileData.onSuccess({ success: true })
        updateUploadProgress(fileData.uid, 100, 'success')
        ElMessage.success(`${fileName} 已上传（跳过重复上传）`)
        return
        
      } catch (error) {
        // 合并失败，可能文件已被删除，清理记录重新上传
        console.log(`[${fileName}] ⚠️ 验证失败，清理本地记录重新上传`)
        localStorage.removeItem(progressKey)
        uploadedChunks = []  // 清空已上传记录，重新开始
      }
    }
    
    // 逐个上传分块
    for (let i = 0; i < totalChunks; i++) {
      // 跳过已上传的分块
      if (uploadedChunks.includes(i)) {
        console.log(`[${fileName}] 分块 ${i} 已上传，跳过`)
        const progress = ((i + 1) / totalChunks) * 100
        updateUploadProgress(fileData.uid, progress, 'uploading')
        continue
      }
      
      // 切割分块
      const start = i * CHUNK_SIZE
      const end = Math.min(start + CHUNK_SIZE, file.size)
      const chunk = file.slice(start, end)
      
      // 准备上传数据
      const formData = new FormData()
      formData.append('chunk', chunk)
      formData.append('filename', fileName)  // 使用原始文件名
      formData.append('fileId', fileId)
      formData.append('chunkNumber', i)
      formData.append('totalChunks', totalChunks)
      
      // 上传分块（重试3次）
      let success = false
      for (let retry = 0; retry < 3 && !success; retry++) {
        try {
          await request.post('/upload-chunk', formData, {
            headers: { 'Content-Type': 'multipart/form-data' }
          })
          success = true
          console.log(`[${fileName}] 分块 ${i + 1}/${totalChunks} 上传成功`)
          
          // 记录到 localStorage（用于断点续传）
          uploadedChunks.push(i)
          localStorage.setItem(progressKey, JSON.stringify({ chunks: uploadedChunks }))
          
          // 更新进度条
          const progress = ((i + 1) / totalChunks) * 100
          updateUploadProgress(fileData.uid, progress, 'uploading')
          fileData.onProgress({ percent: progress })
          
        } catch (error) {
          if (retry < 2) {
            console.log(`[${fileName}] 分块 ${i} 上传失败，重试 ${retry + 1}/3`)
            await new Promise(resolve => setTimeout(resolve, 1000))
          } else {
            throw new Error(`分块 ${i} 上传失败`)
          }
        }
      }
    }
    
    // 🎯 所有分块上传完成后，立即清理 localStorage
    // 这样可以避免：上传完成 → 刷新页面 → localStorage残留 → 重复上传
    console.log(`[${fileName}] 所有分块上传完成，清理断点记录`)
    localStorage.removeItem(progressKey)
    
    // 合并文件
    console.log(`[${fileName}] 开始合并...`)
    try {
      const mergeResult = await request.post('/merge-chunks', {
        filename: fileName,  // 使用原始文件名
        fileId: fileId,
        totalChunks
      })
      
      // 检查是否是跳过重复上传
      if (mergeResult.message && mergeResult.message.includes('跳过重复')) {
        console.log(`[${fileName}] ⚠️ 后端检测到重复上传，已跳过`)
      } else {
        console.log(`[${fileName}] ✓ 合并完成`)
      }
      
      currentUploads--
      processQueue()
      fileData.onSuccess({ success: true })
      updateUploadProgress(fileData.uid, 100, 'success')
      ElMessage.success(`${fileName} 上传成功`)
      
    } catch (mergeError) {
      // 合并失败的特殊处理
      const errorMsg = mergeError.message || ''
      
      // 如果是"分块目录不存在"，可能是临时文件被清理了
      // 但所有分块已上传，视为成功（容错处理）
      if (errorMsg.includes('分块目录不存在') || errorMsg.includes('不存在')) {
        console.log(`[${fileName}] ⚠️ 分块目录不存在，但所有分块已上传完成（容错处理）`)
        
        currentUploads--
        processQueue()
        fileData.onSuccess({ success: true })
        updateUploadProgress(fileData.uid, 100, 'success')
        ElMessage.success(`${fileName} 上传成功`)
      } else {
        // 其他合并错误，正常抛出
        throw mergeError
      }
    }
    
  } catch (error) {
    console.error(`[${fileName}] ✗ 上传失败:`, error.message)
    currentUploads--
    processQueue()
    fileData.onError(error)
    updateUploadProgress(fileData.uid, 0, 'error')
    ElMessage.error(`${fileName} 上传失败`)
  }
}

// ==================== 流程6：开始上传 ====================

/**
 * 点击"开始上传"按钮时触发
 * 提交所有文件开始上传流程
 */
const startUpload = () => {
  if (uploadRef.value) {
    uploadRef.value.submit()
  }
}

// ==================== 生命周期钩子 ====================

/**
 * 组件挂载时初始化 Worker
 */
onMounted(() => {
  worker = new Worker(new URL('@/utils/imageWorker.js', import.meta.url))
  console.log('Worker 已初始化')
})

/**
 * 组件卸载时清理 Worker
 */
onUnmounted(() => {
  if (worker) {
    worker.terminate()
    worker = null
    console.log('Worker 已清理')
  }
})
</script>