import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import type { XRayApi } from "@project-xray/contracts";
import "./styles.css";
import "./design-system.css";

if (!window.xray) {
  const desktopOnly = async (): Promise<never> => { throw new Error("此操作仅在 Project X-Ray 桌面端可用"); };
  const previewApi: XRayApi = {
    getCurrentProject: async () => null,
    selectLocalProject: desktopOnly,
    importLocalProject: desktopOnly,
    importGitProject: desktopOnly,
    cancelIndex: desktopOnly,
    retryIndex: desktopOnly,
    onIndexEvent: () => () => undefined,
    getSnapshotState: desktopOnly,
    listModules: desktopOnly,
    getModuleOverview: desktopOnly,
    expandModule: desktopOnly,
    getModuleRelationEdges: desktopOnly,
    search: desktopOnly,
    queryGraph: desktopOnly,
    getEvidence: desktopOnly,
    findEvidence: desktopOnly,
    getFlow: desktopOnly,
    explainFeature: desktopOnly,
    startComparison: desktopOnly,
    cancelComparison: desktopOnly,
    onComparisonEvent: () => () => undefined,
    loadChangeReport: desktopOnly,
    getChangeReportState: desktopOnly,
    createOwnershipQuestions: desktopOnly,
    gradeOwnershipAnswer: desktopOnly,
    getOwnershipProgress: desktopOnly,
    readSource: desktopOnly,
  };
  window.xray = previewApi;
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
