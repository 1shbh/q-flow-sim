import { create } from 'zustand'
import type { ActiveAnimation, AnimationTick, CanvasSelection, Scenario } from './types'

type ScenarioUpdate = Scenario | null | ((current: Scenario | null) => Scenario | null)

type QFlowState = {
  scenario: Scenario | null
  scenarioRevision: number
  pendingScenarioEdits: number
  selection: CanvasSelection
  animationTick: AnimationTick | null
  activeAnimation: ActiveAnimation | null
  setScenario: (update: ScenarioUpdate) => void
  setScenarioIfRevision: (expectedRevision: number, update: ScenarioUpdate) => boolean
  beginScenarioEdit: () => number
  finishScenarioEdit: () => void
  setSelection: (selection: CanvasSelection) => void
  setAnimationTick: (tick: AnimationTick | null) => void
  setActiveAnimation: (animation: ActiveAnimation | null) => void
}

export const useQFlowStore = create<QFlowState>((set) => ({
  scenario: null,
  scenarioRevision: 0,
  pendingScenarioEdits: 0,
  selection: null,
  animationTick: null,
  activeAnimation: null,
  setScenario: (update) => set((state) => ({
    scenario: typeof update === 'function' ? update(state.scenario) : update,
    scenarioRevision: state.scenarioRevision + 1,
  })),
  setScenarioIfRevision: (expectedRevision, update) => {
    let committed = false
    set((state) => {
      if (state.scenarioRevision !== expectedRevision) return state
      committed = true
      return { scenario: typeof update === 'function' ? update(state.scenario) : update, scenarioRevision: state.scenarioRevision + 1 }
    })
    return committed
  },
  beginScenarioEdit: () => {
    let revision = 0
    set((state) => { revision = state.scenarioRevision + 1; return { scenarioRevision: revision, pendingScenarioEdits: state.pendingScenarioEdits + 1 } })
    return revision
  },
  finishScenarioEdit: () => set((state) => ({ pendingScenarioEdits: Math.max(0, state.pendingScenarioEdits - 1) })),
  setSelection: (selection) => set({ selection }),
  setAnimationTick: (animationTick) => set({ animationTick }),
  setActiveAnimation: (activeAnimation) => set({ activeAnimation }),
}))
