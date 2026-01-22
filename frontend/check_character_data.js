// 临时调试脚本：检查角色数据
console.log('=== 角色数据调试 ===');

// 模拟从后端获取的角色数据
const mockCharacter = {
  id: 1,
  name: "星仔",
  description: "一只拥有雪白色的小猫...",
  image_url: "https://storage.googleapis.com/ai-sandbox-videofx/image/0c29c3b9-81bb-4afd-8f3e-987c9cab84d4?GoogleAccessId=labs-ai-sandbox-videoserver-prod@system.gserviceaccount.com&Expires=1769077441&Signature=..."
};

// 测试 getStaticUrl 函数
function getStaticUrl(path) {
  if (!path) return null;
  if (path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }
  return `http://localhost:18765${path}`;
}

console.log('原始 image_url:', mockCharacter.image_url);
console.log('处理后 URL:', getStaticUrl(mockCharacter.image_url));
console.log('是否是完整 URL:', mockCharacter.image_url?.startsWith('http'));
