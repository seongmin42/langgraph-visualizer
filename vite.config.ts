import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base: './' 로 두면 GitHub Pages 등 하위 경로에서도 정적 빌드가 그대로 동작한다.
export default defineConfig({
  base: './',
  plugins: [react()],
});
