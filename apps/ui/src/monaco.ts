import { loader } from "@monaco-editor/react";
import * as monaco from "../node_modules/monaco-editor/esm/vs/editor/editor.api";
import "../node_modules/monaco-editor/esm/vs/basic-languages/monaco.contribution.js";
import EditorWorker from "../node_modules/monaco-editor/esm/vs/editor/editor.worker.js?worker";

self.MonacoEnvironment = {
  getWorker(_moduleId: string, label: string): Worker {
    return new EditorWorker();
  },
};

loader.config({ monaco });
