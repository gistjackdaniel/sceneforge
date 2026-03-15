import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./app/App";
import { EditorStoreProvider } from "./state/editorStore";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <EditorStoreProvider>
      <App />
    </EditorStoreProvider>
  </React.StrictMode>,
);
