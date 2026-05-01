import type { Material } from "@babylonjs/core/Materials/material";
import type { Scene } from "@babylonjs/core/scene";

import { analyzeMmeEffectIR, type MmeEffectAnalysis } from "./mme-effect-mapper";
import {
    createMmeFallbackMaterial,
    disposeMmeFallbackMaterial,
    type MmeFallbackMaterialFactoryResult,
} from "./mme-fallback-material-factory";
import { planMmeFallbackPreset, type MmeFallbackPlan } from "./mme-fallback-preset-planner";
import type { MMEManifest } from "./mme-compat-manifest";
import type { MMEEffectIR } from "./mme-fx-parser";

export type MmeFallbackControllerMode = "preview" | "apply";

export type MmeFallbackPreviewInput = {
    readonly effectId: string;
    readonly effect: MMEEffectIR;
    readonly targetName?: string | null;
    readonly meshName?: string | null;
    readonly materialName?: string | null;
    readonly originalMaterial?: Material | null;
    readonly sourcePath?: string | null;
    readonly scene?: Scene | null;
};

export type MmeFallbackPreviewPlanItem = {
    readonly effectId: string;
    readonly targetName: string | null;
    readonly meshName: string | null;
    readonly materialName: string | null;
    readonly sourcePath: string | null;
    readonly analysisStatus: MmeEffectAnalysis["status"];
    readonly analysisConfidence: number;
    readonly fallbackConfidence: number;
    readonly preset: MmeFallbackPlan["preset"];
    readonly fallbackReasons: readonly string[];
    readonly mappedFields: Readonly<Record<string, unknown>>;
    readonly blockedByUnsupportedFeatures: readonly string[];
    readonly factoryStatus: MmeFallbackMaterialFactoryResult["status"];
    readonly warnings: readonly string[];
};

export type MmeFallbackControllerState = {
    readonly enabled: boolean;
    readonly mode: MmeFallbackControllerMode;
    readonly experimentalApplyEnabled: boolean;
    readonly selectedEffectId: string | null;
    readonly activeTargets: readonly string[];
    readonly plannedTargets: readonly MmeFallbackPreviewPlanItem[];
};

export type MmeFallbackApplyResult = {
    readonly status: "blocked" | "unsupported" | "applied";
    readonly reason: string;
    readonly warnings: readonly string[];
};

export type MmeFallbackApplyGateStatus = {
    readonly experimentalApplyEnabled: boolean;
};

export type MmeFallbackRevertResult = {
    readonly status: "noop" | "blocked" | "reverted";
    readonly reason: string;
    readonly warnings: readonly string[];
};

export type MmeFallbackApplyTargetRecord = {
    readonly effectId: string;
    readonly targetName: string | null;
    readonly meshName: string | null;
    readonly materialName: string | null;
    readonly sourcePath: string | null;
    readonly originalMaterial: Material | null;
    readonly originalMaterialAvailable: boolean;
    readonly plannedFallback: MmeFallbackPreviewPlanItem;
    readonly plannedFallbackOwnership: "none" | "controller" | "external";
};

export type MmeFallbackApplyTransaction = {
    readonly transactionId: string;
    readonly createdAt: string;
    readonly targetRecords: readonly MmeFallbackApplyTargetRecord[];
    readonly status: "planned" | "applied" | "reverted" | "failed";
};

export class MmeFallbackController {
    private enabled = false;
    private mode: MmeFallbackControllerMode = "preview";
    private experimentalApplyEnabled = false;
    private selectedEffectId: string | null = null;
    private activeTargets: string[] = [];
    private plannedTargets: MmeFallbackPreviewPlanItem[] = [];
    private applyPlan: MmeFallbackApplyTransaction | null = null;
    private readonly ownedFactoryResults = new Set<MmeFallbackMaterialFactoryResult>();

    public getState(): MmeFallbackControllerState {
        return {
            enabled: this.enabled,
            mode: this.mode,
            experimentalApplyEnabled: this.experimentalApplyEnabled,
            selectedEffectId: this.selectedEffectId,
            activeTargets: [...this.activeTargets],
            plannedTargets: [...this.plannedTargets],
        };
    }

    public setEnabled(enabled: boolean): void {
        this.enabled = enabled;
        if (!enabled) {
            this.clearPreview();
            this.clearApplyPlan();
        }
    }

    public setMode(mode: MmeFallbackControllerMode): void {
        this.mode = mode;
    }

    public setExperimentalApplyEnabled(enabled: boolean): void {
        this.experimentalApplyEnabled = enabled;
    }

    public isExperimentalApplyEnabled(): boolean {
        return this.experimentalApplyEnabled;
    }

    public getApplyGateStatus(): MmeFallbackApplyGateStatus {
        return {
            experimentalApplyEnabled: this.experimentalApplyEnabled,
        };
    }

    public buildPreviewPlan(
        inputs: readonly MmeFallbackPreviewInput[],
        context?: { manifest?: Pick<MMEManifest, "textureCandidates"> },
    ): readonly MmeFallbackPreviewPlanItem[] {
        this.disposeOwnedFactoryResults();

        if (!this.enabled) {
            this.selectedEffectId = null;
            this.activeTargets = [];
            this.plannedTargets = [];
            return this.plannedTargets;
        }

        const previewItems = this.buildPlannedTargets(inputs, context);
        const activeTargets = inputs.map((input) => input.effectId);

        this.selectedEffectId = inputs[0]?.effectId ?? null;
        this.activeTargets = activeTargets;
        this.plannedTargets = previewItems;
        return this.plannedTargets;
    }

    public clearPreview(): void {
        this.disposeOwnedFactoryResults();
        this.selectedEffectId = null;
        this.activeTargets = [];
        this.plannedTargets = [];
    }

    public planApply(
        inputs: readonly MmeFallbackPreviewInput[],
        context?: { manifest?: Pick<MMEManifest, "textureCandidates"> },
    ): MmeFallbackApplyTransaction | null {
        const previewPlan = this.buildPlannedTargets(inputs, context);
        if (previewPlan.length === 0) {
            this.applyPlan = null;
            return this.applyPlan;
        }

        this.applyPlan = {
            transactionId: this.createTransactionId(),
            createdAt: new Date().toISOString(),
            targetRecords: previewPlan.map((entry, index) => ({
                effectId: entry.effectId,
                targetName: entry.targetName,
                meshName: entry.meshName,
                materialName: entry.materialName,
                sourcePath: entry.sourcePath,
                originalMaterial: inputs[index]?.originalMaterial ?? null,
                originalMaterialAvailable: Object.prototype.hasOwnProperty.call(inputs[index] ?? {}, "originalMaterial"),
                plannedFallback: entry,
                plannedFallbackOwnership: "none",
            })),
            status: "planned",
        };

        return this.applyPlan;
    }

    public clearApplyPlan(): void {
        this.applyPlan = null;
    }

    public getApplyPlan(): MmeFallbackApplyTransaction | null {
        return this.applyPlan;
    }

    public applyFallback(): MmeFallbackApplyResult {
        if (!this.enabled) {
            return {
                status: "blocked",
                reason: "controller-disabled",
                warnings: ["Fallback apply controller is disabled"],
            };
        }
        if (this.mode !== "apply") {
            return {
                status: "blocked",
                reason: "not-apply-mode",
                warnings: ["Fallback apply requires apply mode"],
            };
        }
        if (!this.experimentalApplyEnabled) {
            return {
                status: "blocked",
                reason: "experimental-apply-disabled",
                warnings: ["Experimental fallback apply opt-in is disabled"],
            };
        }
        if (!this.applyPlan) {
            return {
                status: "blocked",
                reason: "apply-plan-missing",
                warnings: ["Fallback apply requires an explicit apply plan"],
            };
        }
        return {
            status: "unsupported",
            reason: "apply-not-implemented",
            warnings: ["Actual fallback material assignment is intentionally not implemented in this step"],
        };
    }

    public revertApply(): MmeFallbackRevertResult {
        if (!this.applyPlan) {
            return {
                status: "noop",
                reason: "no-transaction",
                warnings: ["No fallback apply transaction exists to revert"],
            };
        }
        if (this.applyPlan.status !== "applied") {
            return {
                status: "noop",
                reason: "transaction-not-applied",
                warnings: ["Fallback apply transaction has not been applied"],
            };
        }

        return {
            status: "blocked",
            reason: "revert-not-implemented",
            warnings: ["Fallback material revert is intentionally not implemented in this step"],
        };
    }

    public dispose(): void {
        this.setEnabled(false);
        this.setExperimentalApplyEnabled(false);
        this.clearApplyPlan();
        this.disposeOwnedFactoryResults();
    }

    private disposeOwnedFactoryResults(): void {
        for (const result of this.ownedFactoryResults) {
            disposeMmeFallbackMaterial(result);
        }
        this.ownedFactoryResults.clear();
    }

    private buildPlannedTargets(
        inputs: readonly MmeFallbackPreviewInput[],
        context?: { manifest?: Pick<MMEManifest, "textureCandidates"> },
    ): MmeFallbackPreviewPlanItem[] {
        const previewItems: MmeFallbackPreviewPlanItem[] = [];

        for (const input of inputs) {
            const analysis: MmeEffectAnalysis = analyzeMmeEffectIR(input.effect, context);
            const plan = planMmeFallbackPreset(analysis, input.effect, context);
            const factoryResult = createMmeFallbackMaterial({
                scene: input.scene ?? null,
                plan,
                analysis,
                targetMetadata: {
                    targetName: input.targetName ?? input.materialName ?? input.effectId,
                    sourcePath: input.sourcePath ?? input.effect.path,
                },
                dryRun: true,
            });

            previewItems.push({
                effectId: input.effectId,
                targetName: input.targetName ?? null,
                meshName: input.meshName ?? null,
                materialName: input.materialName ?? null,
                sourcePath: input.sourcePath ?? input.effect.path,
                analysisStatus: analysis.status,
                analysisConfidence: analysis.confidence,
                fallbackConfidence: plan.confidence,
                preset: plan.preset,
                fallbackReasons: plan.reasons,
                mappedFields: Object.fromEntries(Object.entries(analysis.mappedFields)
                    .filter(([, value]) => value !== null)),
                blockedByUnsupportedFeatures: plan.blockedByUnsupportedFeatures,
                factoryStatus: factoryResult.status,
                warnings: [...plan.warnings, ...factoryResult.warnings],
            });
        }

        return previewItems;
    }

    private createTransactionId(): string {
        return `mme-fallback-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    }
}
