import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "qjsbox-studio/styles.css";
import { App } from "./App";
import "./demo.css";

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
