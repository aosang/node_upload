# Worker 并发问题修复

## 🐛 问题描述

**症状**：
- 上传 3 个不同的图片（test1.jpg, test2.jpg, test3.jpg）
- 后端保存的 3 张图片内容都相同
- 服务器日志显示正确接收了 3 个文件，文件名也不同
- 但文件内容却是一样的

## 🔍 问题根源

### Worker 是单例模式

```javascript
// 组件中只有一个 Worker 实例
let worker = null

onMounted(() => {
  worker = new Worker(...)  // 只创建一次
})
```

### 并发压缩导致消息混乱

```
时间轴：
t1: 用户选择 3 个文件
t2: 同时调用 beforeUpload() 3 次
    ├─ test1.jpg → worker.postMessage({ file: test1 })
    ├─ test2.jpg → worker.postMessage({ file: test2 })
    └─ test3.jpg → worker.postMessage({ file: test3 })

t3: Worker 开始处理（可能乱序）
    ├─ 处理 test1
    ├─ 处理 test2
    └─ 处理 test3

t4: Worker 返回结果（可能乱序）
    ├─ worker.postMessage({ file: compressed1 })
    ├─ worker.postMessage({ file: compressed2 })
    └─ worker.postMessage({ file: compressed3 })

问题：3 个 beforeUpload() 都监听 worker.onmessage
      第一个返回的结果被 3 个监听器都收到了！
      导致 3 个文件都变成了同一个压缩结果
```

### 具体流程

```javascript
// 第1个文件
beforeUpload(test1.jpg)
  worker.addEventListener('message', handleMessage1)  // 监听器1
  worker.postMessage({ file: test1 })

// 第2个文件（几乎同时）
beforeUpload(test2.jpg)
  worker.addEventListener('message', handleMessage2)  // 监听器2
  worker.postMessage({ file: test2 })

// 第3个文件（几乎同时）
beforeUpload(test3.jpg)
  worker.addEventListener('message', handleMessage3)  // 监听器3
  worker.postMessage({ file: test3 })

// Worker 返回第一个结果（假设是 test1 的结果）
worker.postMessage({ success: true, file: compressed1 })

// 问题：3 个监听器都收到了这个消息！
handleMessage1 收到 → resolve(compressed1) ✓
handleMessage2 收到 → resolve(compressed1) ✗ 错误！应该是 compressed2
handleMessage3 收到 → resolve(compressed1) ✗ 错误！应该是 compressed3

// 结果：3 个文件都变成了 compressed1
```

## ✅ 解决方案

### 给每个任务添加唯一ID

```javascript
const beforeUpload = (file) => {
  // 生成唯一任务ID
  const taskId = `${file.name}_${file.size}_${Date.now()}_${Math.random()}`
  
  const handleMessage = (event) => {
    // 关键：只处理当前任务的响应
    if (event.data.taskId === taskId) {
      worker.removeEventListener('message', handleMessage)
      
      if (event.data.success) {
        resolve(event.data.file)
      }
    }
  }
  
  worker.addEventListener('message', handleMessage)
  
  // 发送时带上 taskId
  worker.postMessage({ 
    file, 
    quality: 0.8, 
    targetFormat: 'jpeg',
    taskId  // 传递任务ID
  })
}
```

### Worker 返回时带上 taskId

```javascript
// imageWorker.js
self.onmessage = async function (e) {
  const { file, quality, targetFormat, taskId } = e.data
  
  try {
    const compressedFile = await compressImage(file, quality, targetFormat)
    
    // 关键：返回时带上 taskId
    self.postMessage({ 
      success: true, 
      file: compressedFile,
      taskId: taskId  // 返回任务ID
    })
  } catch (error) {
    self.postMessage({ 
      success: false, 
      error: error.message,
      taskId: taskId
    })
  }
}
```

### 修复后的流程

```
时间轴：
t1: 用户选择 3 个文件

t2: 并发压缩
    test1.jpg → taskId: "test1.jpg_512000_1704067200000_abc123"
    test2.jpg → taskId: "test2.jpg_819200_1704067201000_def456"
    test3.jpg → taskId: "test3.jpg_1048576_1704067202000_ghi789"

t3: Worker 处理并返回

t4: 返回结果（带 taskId）
    { file: compressed1, taskId: "...abc123" }
    { file: compressed2, taskId: "...def456" }
    { file: compressed3, taskId: "...ghi789" }

t5: 各自的监听器只处理自己的任务
    handleMessage1 检查 taskId === "...abc123" → ✓ 处理
    handleMessage1 检查 taskId === "...def456" → ✗ 忽略
    handleMessage1 检查 taskId === "...ghi789" → ✗ 忽略

    handleMessage2 检查 taskId === "...abc123" → ✗ 忽略
    handleMessage2 检查 taskId === "...def456" → ✓ 处理
    handleMessage2 检查 taskId === "...ghi789" → ✗ 忽略

    handleMessage3 检查 taskId === "...abc123" → ✗ 忽略
    handleMessage3 检查 taskId === "...def456" → ✗ 忽略
    handleMessage3 检查 taskId === "...ghi789" → ✓ 处理

结果：每个文件得到正确的压缩结果！✓
```

## 📊 对比

### 修复前

```
test1.jpg → Worker → compressed1
test2.jpg → Worker → compressed1  ✗ 错误
test3.jpg → Worker → compressed1  ✗ 错误

uploads/
├── test1-xxx.jpg  (compressed1 的内容)
├── test2-xxx.jpg  (compressed1 的内容) ✗ 相同
└── test3-xxx.jpg  (compressed1 的内容) ✗ 相同
```

### 修复后

```
test1.jpg → Worker (taskId: abc123) → compressed1
test2.jpg → Worker (taskId: def456) → compressed2  ✓ 正确
test3.jpg → Worker (taskId: ghi789) → compressed3  ✓ 正确

uploads/
├── test1-xxx.jpg  (compressed1 的内容)
├── test2-xxx.jpg  (compressed2 的内容) ✓ 不同
└── test3-xxx.jpg  (compressed3 的内容) ✓ 不同
```

## 🧪 测试验证

### 观察控制台

**预期输出**：
```
[test1.jpg] 开始压缩... (任务ID: test1.jpg_512000_1704067200000_abc123)
[test2.jpg] 开始压缩... (任务ID: test2.jpg_819200_1704067201000_def456)
[test3.jpg] 开始压缩... (任务ID: test3.jpg_1048576_1704067202000_ghi789)

[test1.jpg] 压缩完成: 512000 -> 102400 字节
[test2.jpg] 压缩完成: 819200 -> 122880 字节
[test3.jpg] 压缩完成: 1258291 -> 145920 字节

[test1.jpg] ✓ 上传完成
[test2.jpg] ✓ 上传完成
[test3.jpg] ✓ 上传完成
```

### 验证结果

```bash
# 检查文件大小
ls -lh upload_server/uploads/

# 应该看到：
test1-xxx.jpg  ~100KB  ← 不同
test2-xxx.jpg  ~120KB  ← 不同
test3-xxx.jpg  ~140KB  ← 不同

# 打开图片查看内容，应该是 3 张不同的图片
```

## 💡 关键要点

### 1. Worker 是共享的

```javascript
// 组件中只有一个 Worker 实例
let worker = null

// 多次调用 beforeUpload，共享同一个 worker
beforeUpload(file1)  // 使用 worker
beforeUpload(file2)  // 使用同一个 worker
beforeUpload(file3)  // 使用同一个 worker
```

### 2. 异步消息需要标识

```javascript
// 没有标识 - 无法区分是谁的响应
worker.postMessage({ file: test1 })
worker.onmessage = (e) => {
  // 不知道这是 test1、test2 还是 test3 的响应
}

// 有标识 - 可以区分
worker.postMessage({ file: test1, taskId: 'abc' })
worker.onmessage = (e) => {
  if (e.data.taskId === 'abc') {
    // 确定是 test1 的响应
  }
}
```

### 3. taskId 的生成

```javascript
// 包含多个因素，确保唯一性
const taskId = `${file.name}_${file.size}_${Date.now()}_${Math.random()}`

// 示例
"test1.jpg_512000_1704067200000_0.123456"
"test2.jpg_819200_1704067200001_0.789012"  ← 时间戳和随机数不同
```

## 🎓 初学者理解

**比喻**：

```
想象一个快递站（Worker）：
- 你和另外2个人同时寄快递
- 你们都在等快递员返回发货单
- 但快递员没有标记，无法区分谁是谁的

修复前：
快递员拿回第一个发货单 → 3个人都以为是自己的 → 拿走了
结果：3个人都拿到了同一个发货单

修复后：
每个包裹贴上姓名标签
快递员返回时带着标签
你只拿有你名字的发货单
结果：每个人拿到正确的发货单
```

**代码对应**：

```javascript
// 贴标签
const myName = "张三"  // taskId
sendPackage({ package: myPackage, name: myName })

// 等待返回
onReturn = (result) => {
  if (result.name === myName) {  // 检查标签
    console.log("这是我的！")
    take(result.receipt)
  }
}
```

## 📝 总结

### 问题
- Worker 单例 + 并发调用 = 消息混乱

### 原因
- 多个监听器收到同一个消息
- 无法区分是谁的响应

### 解决
- 每个任务添加唯一 taskId
- 响应时返回 taskId
- 监听器只处理匹配的 taskId

### 结果
- ✅ 每个文件得到正确的压缩结果
- ✅ 3 个不同文件保存为 3 个不同内容
- ✅ 完美解决并发问题

这就是最终的修复！现在应该不会再有问题了。🎉

