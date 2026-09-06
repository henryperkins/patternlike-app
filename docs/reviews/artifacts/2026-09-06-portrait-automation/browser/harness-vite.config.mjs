import { defineConfig } from '/home/henry/patternlike-app/.worktrees/portrait-explorer/node_modules/vite/dist/node/index.js';
import react from '/home/henry/patternlike-app/.worktrees/portrait-explorer/node_modules/@vitejs/plugin-react/dist/index.js';
export default defineConfig({root:'/tmp/portrait-automation-account',cacheDir:'/tmp/portrait-automation-account/.vite-cache',plugins:[react()],server:{host:'127.0.0.1',port:4187,strictPort:true,fs:{allow:['/tmp/portrait-automation-account','/home/henry/patternlike-app/.worktrees/portrait-explorer']}},resolve:{dedupe:['react','react-dom']}});
