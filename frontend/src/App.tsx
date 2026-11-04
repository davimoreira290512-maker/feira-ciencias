import { Routes, Route, useLocation } from "react-router-dom";
import AuthCallback from "@/pages/AuthCallback";
import Home from "@/pages/Home";

// One <Route> per page in src/pages; BrowserRouter already wraps this in main.tsx.
export default function App() {
  const location = useLocation();
  const sessionId = new URLSearchParams(location.hash.slice(1)).get("session_id");

  if (sessionId) {
    return <AuthCallback sessionId={sessionId} />;
  }

  return (
    <Routes>
      <Route path="/" element={<Home />} />
    </Routes>
  );
}
