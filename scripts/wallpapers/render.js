/**
 * Playwright snippet that renders scripts/wallpapers/flow.html into the wallpaper JPEGs.
 *
 * Run it with the dev server up (Vite serves the generator page from the project root), e.g.
 * through the Playwright MCP `browser_run_code` tool with this file. Each variant is drawn on a
 * 1440×900 canvas at 2× and saved as a 2880×1800 JPEG in public/wallpapers.
 */
async (page) => {
  const browser = page.context().browser();
  const out = [];
  for (const mode of ['light', 'dark']) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
    const p = await ctx.newPage();
    await p.goto(`http://localhost:5173/scripts/wallpapers/flow.html?mode=${mode}`);
    await p.waitForSelector('body[data-ready="true"]', { timeout: 60000 });
    const path = `/Users/aodjo/Documents/webOS/public/wallpapers/flow-${mode}.jpg`;
    await p.screenshot({ path, type: 'jpeg', quality: 88 });
    out.push(path);
    await ctx.close();
  }
  return out;
}
