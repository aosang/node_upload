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
    <!-- <div v-for="file in uploadStatus" :key="file.uid" style="margin-top: 15px;">
      <div style="margin-bottom: 5px;">
        <span>{{ file.name }}</span>
        <span v-if="file.status === 'success'" style="color: #67c23a; margin-left: 10px;">✓ 上传成功</span>
        <span v-if="file.status === 'error'" style="color: #f56c6c; margin-left: 10px;">✗ 上传失败</span>
      </div>
      <el-progress 
        :percentage="Math.floor(file.progress)" 
        :status="file.status === 'success' ? 'success' : file.status === 'error' ? 'exception' : ''"
      />
    </div> -->
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { ElMessage } from 'element-plus'
import request from '@/utils/request'

const fileList = ref([])           // 文件列表
const uploadStatus = ref([])       // 上传状态列表
const uploadRef = ref(null)        // 上传组件引用

let uploadQueue = []               // 上传队列
let currentUploads = 0             // 当前正在上传的数量
let worker = null                  // Worker实例

// 配置参数
const maxConcurrentUploads = 3            // 最大并发上传数
const maxSizeInMB = 3                   // 最大文件大小（MB）
const CHUNK_SIZE = 1 * 1024 * 1024  

const handleFileChange = (file, fileListData) => {
  console.log(file, fileListData);
}

const beforeUpload = () => {
  
}
const customHttpRequest = () => {
  
}
const startUpload = () => {
  
}

</script>

<style scoped>

</style>