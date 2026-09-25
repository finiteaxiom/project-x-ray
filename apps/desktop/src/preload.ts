import { contextBridge, ipcRenderer } from "electron";
import { IPC_CHANNELS, comparisonTaskEventSchema, indexTaskEventSchema, type XRayApi } from "@project-xray/contracts";

const api: XRayApi = {
  selectLocalProject: () => ipcRenderer.invoke(IPC_CHANNELS.selectLocalProject),
  importLocalProject: (rootPath) => ipcRenderer.invoke(IPC_CHANNELS.importLocalProject, rootPath),
  importGitProject: (input) => ipcRenderer.invoke(IPC_CHANNELS.importGitProject, input),
  cancelIndex: (taskId) => ipcRenderer.invoke(IPC_CHANNELS.cancelIndex, taskId),
  retryIndex: (taskId) => ipcRenderer.invoke(IPC_CHANNELS.retryIndex, taskId),
  onIndexEvent: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, raw: unknown): void => { const parsed = indexTaskEventSchema.safeParse(raw); if (parsed.success) listener(parsed.data); };
    ipcRenderer.on(IPC_CHANNELS.indexEvent, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.indexEvent, handler);
  },
  getCurrentProject: () => ipcRenderer.invoke(IPC_CHANNELS.getCurrentProject),
  getSnapshotState: (ref) => ipcRenderer.invoke(IPC_CHANNELS.getSnapshotState, ref),
  listModules: (input) => ipcRenderer.invoke(IPC_CHANNELS.listModules, input),
  getModuleOverview: (input) => ipcRenderer.invoke(IPC_CHANNELS.moduleOverview, input),
  expandModule: (input) => ipcRenderer.invoke(IPC_CHANNELS.expandModule, input),
  getModuleRelationEdges: (input) => ipcRenderer.invoke(IPC_CHANNELS.moduleRelationEdges, input),
  search: (input) => ipcRenderer.invoke(IPC_CHANNELS.search, input),
  queryGraph: (input) => ipcRenderer.invoke(IPC_CHANNELS.queryGraph, input),
  getEvidence: (input) => ipcRenderer.invoke(IPC_CHANNELS.getEvidence, input),
  findEvidence: (input) => ipcRenderer.invoke(IPC_CHANNELS.findEvidence, input),
  getFlow: (ref, nodeId, depth) => ipcRenderer.invoke(IPC_CHANNELS.getFlow, ref, nodeId, depth),
  explainFeature: (ref, query) => ipcRenderer.invoke(IPC_CHANNELS.explainFeature, ref, query),
  startComparison: (input) => ipcRenderer.invoke(IPC_CHANNELS.startComparison, input),
  cancelComparison: (taskId) => ipcRenderer.invoke(IPC_CHANNELS.cancelComparison, taskId),
  onComparisonEvent: (listener) => { const handler = (_event: Electron.IpcRendererEvent, raw: unknown): void => { const parsed = comparisonTaskEventSchema.safeParse(raw); if (parsed.success) listener(parsed.data); }; ipcRenderer.on(IPC_CHANNELS.comparisonEvent, handler); return () => ipcRenderer.removeListener(IPC_CHANNELS.comparisonEvent, handler); },
  loadChangeReport: (input) => ipcRenderer.invoke(IPC_CHANNELS.loadChangeReport, input),
  getChangeReportState: (input) => ipcRenderer.invoke(IPC_CHANNELS.changeReportState, input),
  createOwnershipQuestions: (input) => ipcRenderer.invoke(IPC_CHANNELS.createOwnershipQuestions, input),
  gradeOwnershipAnswer: (submission) => ipcRenderer.invoke(IPC_CHANNELS.gradeOwnershipAnswer, submission),
  getOwnershipProgress: (ref) => ipcRenderer.invoke(IPC_CHANNELS.ownershipProgress, ref),
  readSource: (location) => ipcRenderer.invoke(IPC_CHANNELS.readSource, location),
};

contextBridge.exposeInMainWorld("xray", api);
