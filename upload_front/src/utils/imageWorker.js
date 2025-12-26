// imageWorker.js - 使用现代 Web Worker API
self.onmessage = async function (e) {
  const { file, quality, targetFormat, taskId } = e.data;

  try {
    const compressedFile = await compressImage(file, quality, targetFormat);
    // 返回时带上 taskId，确保消息对应正确
    self.postMessage({ 
      success: true, 
      file: compressedFile,
      taskId: taskId  // 关键：返回任务ID
    });
  } catch (error) {
    self.postMessage({ 
      success: false, 
      error: error.message,
      taskId: taskId
    });
  }
};

const compressImage = async (file, quality, format) => {
  // 使用 createImageBitmap 替代 new Image()
  const imageBitmap = await createImageBitmap(file);
  
  // 使用 OffscreenCanvas 替代 document.createElement('canvas')
  const canvas = new OffscreenCanvas(imageBitmap.width, imageBitmap.height);
  const ctx = canvas.getContext('2d');
  
  // 绘制图片到离屏画布
  ctx.drawImage(imageBitmap, 0, 0);
  
  // 转换为 Blob，支持格式转换和质量压缩
  const blob = await canvas.convertToBlob({
    type: `image/${format}`,
    quality: quality
  });
  
  // 将 Blob 转换为 File
  const compressedFile = new File([blob], file.name, {
    type: `image/${format}`,
    lastModified: Date.now(),
  });
  
  // 释放 ImageBitmap 资源
  imageBitmap.close();
  return compressedFile;
};
