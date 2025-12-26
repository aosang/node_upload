// 封装axios
import axios from 'axios'

const request = axios.create({
  baseURL: 'http://localhost:3000',
  timeout: 60000 // 60秒超时，适合文件上传
})

// 请求拦截器
request.interceptors.request.use(config => {
  return config
})

// 响应拦截器
request.interceptors.response.use(response => {
  return response.data
})

export default request