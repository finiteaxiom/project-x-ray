import { remoteNarrativeSchema, remoteTextSchema, RemoteExplanationError, type EvidencePackage, type RemoteNarrative } from "@project-xray/contracts";
import { verifyEvidencePackage } from "./evidence-package.js";
export interface ValidatedExplanation { narrative: RemoteNarrative; localUnknowns: string[]; localLimitations: string[]; localTruncation: EvidencePackage["truncation"]; }
export function validateRemoteNarrative(raw: unknown, evidencePackage: EvidencePackage, local?: { localUnknowns: readonly string[]; localLimitations: readonly string[] }): ValidatedExplanation {
  const pack = verifyEvidencePackage(evidencePackage);
  try {
    const narrative = remoteNarrativeSchema.parse(raw);
    if (narrative.repositoryId !== pack.repositoryId || narrative.snapshotId !== pack.snapshotId || narrative.packageId !== pack.packageId) throw new Error();
    const proofs = new Map(pack.proofs.map(proof => [proof.id, proof]));
    const unknownIds = new Set(pack.proofs.filter(proof => proof.confidence === "unknown").map(proof => proof.id));
    for (const edge of pack.edges) if (edge.confidence === "unknown") unknownIds.add(edge.evidenceId);
    for (const claim of narrative.claims) {
      if (claim.evidenceIds.some(id => !proofs.has(id)) || new Set(claim.evidenceIds).size !== claim.evidenceIds.length || (claim.evidenceIds.some(id => unknownIds.has(id)) && claim.confidence !== "unknown")) throw new Error();
    }
    for (const unknown of narrative.unknowns) if (unknown.evidenceIds.some(id => !proofs.has(id)) || new Set(unknown.evidenceIds).size !== unknown.evidenceIds.length) throw new Error();
    const localUnknowns = [...(local?.localUnknowns ?? pack.unknowns)]; const localLimitations = [...(local?.localLimitations ?? pack.limitations)];
    if (localUnknowns.length > 1200 || localLimitations.length > 1200 || localUnknowns.some(text => !remoteTextSchema.safeParse(text).success) || localLimitations.some(text => !remoteTextSchema.safeParse(text).success) || pack.unknowns.some(text => !localUnknowns.includes(text)) || pack.limitations.some(text => !localLimitations.includes(text))) throw new Error();
    return { narrative, localUnknowns, localLimitations, localTruncation: { ...pack.truncation, reasons: [...pack.truncation.reasons] } };
  } catch { throw new RemoteExplanationError("INVALID_RESPONSE"); }
}
