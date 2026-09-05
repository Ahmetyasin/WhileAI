import { attach, pageFor } from './attach.mjs';
const SITES = {
  chatgpt: 'https://chatgpt.com/',
  gemini: 'https://gemini.google.com/app',
  deepseek: 'https://chat.deepseek.com/',
};
const { ctx } = await attach();
console.log('tabs open:', ctx.pages().length);
for (const [id, url] of Object.entries(SITES)) {
  const page = await pageFor(ctx, url);
  await page.waitForTimeout(5000);
  const s = await page.evaluate(() => {
    const t = document.title.toLowerCase();
    const body = (document.body?.innerText ?? '').slice(0, 500).toLowerCase();
    return {
      title: document.title,
      wall: /just a moment|human verification|attention required|security check/.test(t)
         || /verify you are human|checking your browser/.test(body),
      loginish: /log in|sign in|giriş yap|continue with google/.test(body),
    };
  });
  console.log(`${id.padEnd(10)} ${(s.wall ? 'WALL' : s.loginish ? 'signed out' : 'SIGNED IN').padEnd(11)} ${s.title.slice(0,40)}`);
}
