import { BrowserRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import "./styles/globals.css";
import { HomePage } from "./pages/HomePage";
import { NewProjectPage } from "./pages/NewProjectPage";
import { ProjectsPage } from "./pages/ProjectsPage";
import { ProjectPage } from "./pages/ProjectPage";
import { SettingsModal } from "./components/settings/SettingsModal";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5,
      retry: 1,
    },
  },
});

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/projects" element={<ProjectsPage />} />
          <Route path="/project/new" element={<NewProjectPage />} />
          <Route path="/project/:id" element={<ProjectPage />} />
        </Routes>
        {/* 全局设置弹窗 - 在所有页面都可用 */}
        <SettingsModal />
      </BrowserRouter>
    </QueryClientProvider>
  );
}
