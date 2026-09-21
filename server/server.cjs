/**
 * 启动入口。
 * - 本机演示：node server/server.cjs → 只监听 127.0.0.1:4173，/api 仅接受本机 Host。
 * - 线上预览/部署（平台注入 PORT）：监听 0.0.0.0:$PORT，并放行反向代理域名。
 *   需要局域网访问时：HOST=0.0.0.0 PUBLIC_DEPLOY=1 node server/server.cjs
 */
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || (process.env.PORT ? '0.0.0.0' : '127.0.0.1');
const publicDeploy = process.env.PUBLIC_DEPLOY === '1' || !!process.env.PORT;
require('./auth-server.cjs')
  .createApp({ publicDeploy })
  .listen(port, host, () => console.log(`声入山野已启动 http://127.0.0.1:${port}（bind ${host}${publicDeploy ? '，公网模式' : '，仅本机'}）`));
