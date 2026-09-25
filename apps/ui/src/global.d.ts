import type { XRayApi } from "@project-xray/contracts";

declare global {
  interface Window {
    xray: XRayApi;
  }
}

export {};

