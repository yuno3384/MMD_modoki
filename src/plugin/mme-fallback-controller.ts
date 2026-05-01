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
    readonly selectedEffectId: string | null;
    readonly activeTargets: readonly string[];
    readonly plannedTargets: readonly MmeFallbackPreviewPlanItem[];
};

export type MmeFallbackApplyResult = {
    readonly status: "blocked" | "unsupported" | "applied";
    readonly warnings: readonly string[];
};

export class MmeFallbackController {
    private enabled = false;
    private mode: MmeFallbackControllerMode = "preview";
    private selectedEffectId: string | null = null;
    private activeTargets: string[] = [];
    private plannedTargets: MmeFallbackPreviewPlanItem[] = [];
    private readonly ownedFactoryResults = new Set<MmeFallbackMaterialFactoryResult>();

    public getState(): MmeFallbackControllerState {
        return {
            enabled: this.enabled,
            mode: this.mode,
            selectedEffectId: this.selectedEffectId,
            activeTargets: [...this.activeTargets],
            plannedTargets: [...this.plannedTargets],
        };
    }

    public setEnabled(enabled: boolean): void {
        this.enabled = enabled;
        if (!enabled) {
            this.clearPreview();
        }
    }

    public setMode(mode: MmeFallbackControllerMode): void {
        this.mode = mode;
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

        const previewItems: MmeFallbackPreviewPlanItem[] = [];
        const activeTargets: string[] = [];

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
            activeTargets.push(input.effectId);
        }

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

    public applyFallback(): MmeFallbackApplyResult {
        if (!this.enabled) {
            return {
                status: "blocked",
                warnings: ["Fallback apply is disabled"],
            };
        }
        if (this.mode !== "apply") {
            return {
                status: "blocked",
                warnings: ["Fallback apply requires apply mode"],
            };
        }
        return {
            status: "unsupported",
            warnings: ["Actual fallback material assignment is intentionally not implemented in this step"],
        };
    }

    public dispose(): void {
        this.setEnabled(false);
        this.disposeOwnedFactoryResults();
    }

    private disposeOwnedFactoryResults(): void {
        for (const result of this.ownedFactoryResults) {
            disposeMmeFallbackMaterial(result);
        }
        this.ownedFactoryResults.clear();
    }
}
