/**
 * TUI FormWizard — generic multi-step form with text inputs and selectable lists.
 *
 * Reusable for agent creation, task creation, or any multi-step form.
 * Each step can be a free text input or a selection from a list.
 *
 * Navigation: ↑↓ select items, Tab/Enter confirm step, Esc cancel, Backspace go back.
 */

import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import { tuiColors, LIGHT_RULE } from '../colors.js';
import { useTextInput } from '../hooks/useTextInput.js';
import { TextInput } from './TextInput.js';

/** Option in a select step */
export interface SelectOption {
  value: string;
  label: string;
  hint?: string;
}

/** Step definition */
export interface WizardStep {
  id: string;
  label: string;
  type: 'text' | 'select' | 'textarea' | 'multiselect';
  /** Static options for select type */
  options?: SelectOption[];
  /** Dynamic options based on already-collected values */
  getOptions?: (values: Record<string, string>) => SelectOption[];
  placeholder?: string;
  /** Guidance text shown below the step label */
  description?: string;
  required?: boolean;
  defaultValue?: string;
  /** Skip this step based on previous values */
  skip?: (values: Record<string, string>) => boolean;
  /** Optional suggestion list shown below text input (↓ to browse, filtered by input) */
  suggestions?: SelectOption[];
  /** Validate the current value. Return null if valid, or an error message string. */
  validate?: (value: string) => string | null;
}

export interface FormWizardProps {
  title: string;
  steps: WizardStep[];
  onComplete: (values: Record<string, string>) => void;
  onCancel: () => void;
  width: number;
  height: number;
  /** Called on Ctrl+V (or Ctrl+I fallback) to attempt clipboard image paste. Returns clipboard content type. */
  onPasteImage?: () => Promise<'image' | 'text' | 'empty'>;
  /** Extra text shown in the hint bar footer (e.g. attachment indicator) */
  footerExtra?: string;
  /** Called when user selects a suggestion from a text step's suggestion list */
  onSuggestionSelected?: (suggestionValue: string) => void;
}

const CURSOR = '\u2588'; // █ (used by textarea render)
const CMD_KEY = process.platform === 'darwin' ? '\u2318' : 'Ctrl';

// ── Text editing helpers ─────────────────────────────────────────────

/** Wrap a logical line into visual segments of at most maxWidth characters. */
function wrapTextLine(line: string, maxWidth: number): string[] {
  if (maxWidth <= 0 || line.length <= maxWidth) return [line];
  const segs: string[] = [];
  for (let i = 0; i < line.length; i += maxWidth) {
    segs.push(line.slice(i, i + maxWidth));
  }
  return segs;
}

/** Visual line metadata for textarea rendering and navigation. */
interface VisualLine {
  logicalRow: number;
  startCol: number;
  text: string;
  isFirst: boolean;
}

/** Find word boundary backward from pos (for Ctrl+W / Option+Left in textarea). */
function wordBoundaryBack(text: string, pos: number): number {
  if (pos <= 0) return 0;
  let i = pos - 1;
  while (i > 0 && text[i - 1] === ' ') i--;
  while (i > 0 && text[i - 1] !== ' ') i--;
  return i;
}

/** Find word boundary forward from pos (for Option+Right in textarea). */
function wordBoundaryForward(text: string, pos: number): number {
  if (pos >= text.length) return text.length;
  let i = pos;
  while (i < text.length && text[i] !== ' ') i++;
  while (i < text.length && text[i] === ' ') i++;
  return i;
}

export function FormWizard({ title, steps, onComplete, onCancel, width, height, onPasteImage, footerExtra, onSuggestionSelected }: FormWizardProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [values, setValues] = useState<Record<string, string>>({});

  // Unified text input for single-line text steps (replaces textInput + cursorPos)
  const firstTextDefault = useMemo(() => {
    const firstActive = steps.find((s) => !s.skip?.({}));
    return firstActive?.type === 'text' && firstActive.defaultValue ? firstActive.defaultValue : '';
  }, []);
  const textHook = useTextInput({ initialValue: firstTextDefault });
  // Alias for compatibility with existing code paths (suggestions, validation)
  const textInput = textHook.value;
  // Textarea state: array of lines + cursor row/col
  const [taLines, setTaLines] = useState<string[]>(() => {
    const firstActive = steps.find((s) => !s.skip?.({}));
    if (firstActive?.type === 'textarea' && firstActive.defaultValue) {
      return firstActive.defaultValue.split('\n');
    }
    return [''];
  });
  const [taCursorRow, setTaCursorRow] = useState(0);
  const [taCursorCol, setTaCursorCol] = useState(0);
  const [selectIndex, setSelectIndex] = useState(() => {
    // Pre-select default option for first select step
    const firstActive = steps.find((s) => !s.skip?.({}));
    if (firstActive?.type === 'select' && firstActive.defaultValue) {
      const opts = firstActive.getOptions?.({}) ?? firstActive.options ?? [];
      const idx = opts.findIndex((o) => o.value === firstActive.defaultValue);
      return idx >= 0 ? idx : 0;
    }
    return 0;
  });

  // Resolve active steps (skip those that should be skipped)
  const activeSteps = useMemo(() => {
    return steps.filter((s) => !s.skip?.(values));
  }, [steps, values]);

  const step = activeSteps[currentStep];
  const totalSteps = activeSteps.length;
  const isLastStep = currentStep >= totalSteps - 1;

  // Pre-compute textarea visual lines for navigation and rendering
  const { taLineNumWidth, taContentWidth } = useMemo(() => {
    const lnw = String(taLines.length).length;
    return { taLineNumWidth: lnw, taContentWidth: Math.max(1, width - lnw - 4) };
  }, [taLines.length, width]);

  const taVisualLines = useMemo((): VisualLine[] => {
    if (!step || step.type !== 'textarea') return [];
    const result: VisualLine[] = [];
    for (let r = 0; r < taLines.length; r++) {
      const segs = wrapTextLine(taLines[r] ?? '', taContentWidth);
      for (let s = 0; s < segs.length; s++) {
        result.push({ logicalRow: r, startCol: s * taContentWidth, text: segs[s]!, isFirst: s === 0 });
      }
    }
    return result;
  }, [step?.id, step?.type, taLines, taContentWidth]);

  const taCursorVisualRow = useMemo(() => {
    for (let i = 0; i < taVisualLines.length; i++) {
      const vl = taVisualLines[i]!;
      if (vl.logicalRow !== taCursorRow) continue;
      if (taCursorCol >= vl.startCol && taCursorCol < vl.startCol + taContentWidth) return i;
      // Cursor at end of line: belongs to the last visual line of this logical row
      if (taCursorCol >= vl.startCol && (i + 1 >= taVisualLines.length || taVisualLines[i + 1]!.logicalRow !== taCursorRow)) return i;
    }
    return 0;
  }, [taVisualLines, taCursorRow, taCursorCol, taContentWidth]);

  // Multiselect toggled values (set of selected option values)
  const [multiSelected, setMultiSelected] = useState<Set<string>>(new Set());

  // Suggestion browsing: whether ↓ has been pressed to enter the suggestion list from a text step
  const [browsingSuggestions, setBrowsingSuggestions] = useState(false);
  const [suggestionIndex, setSuggestionIndex] = useState(0);

  // Inline validation state
  const [dirty, setDirty] = useState(false); // true after user types at least one character
  const [validationError, setValidationError] = useState<string | null>(null);
  const [enterBlockHint, setEnterBlockHint] = useState(false);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const enterBlockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Current value for validation (text or textarea)
  const currentValue = useMemo(() => {
    if (!step) return '';
    if (step.type === 'text') return textInput;
    if (step.type === 'textarea') return taLines.join('\n');
    return '';
  }, [step, textInput, taLines]);

  // Debounced validation (300ms)
  const runValidation = useCallback((value: string, validateFn?: (v: string) => string | null) => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    if (!validateFn) { setValidationError(null); return; }
    debounceTimerRef.current = setTimeout(() => {
      setValidationError(validateFn(value));
    }, 300);
  }, []);

  useEffect(() => {
    if (step && step.validate && (step.type === 'text' || step.type === 'textarea')) {
      runValidation(currentValue, step.validate);
    }
    return () => { if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current); };
  }, [currentValue, step, runValidation]);

  // Cleanup enter block hint timer
  useEffect(() => {
    return () => { if (enterBlockTimerRef.current) clearTimeout(enterBlockTimerRef.current); };
  }, []);

  // Resolve options for current select/multiselect step
  const options = useMemo(() => {
    if (!step || (step.type !== 'select' && step.type !== 'multiselect')) return [];
    return step.getOptions?.(values) ?? step.options ?? [];
  }, [step, values]);

  // Clamp selectIndex when options change
  const clampedSelectIndex = Math.min(selectIndex, Math.max(0, options.length - 1));

  // Filtered suggestions for text steps with suggestion lists
  const filteredSuggestions = useMemo(() => {
    if (!step?.suggestions) return [];
    if (!textInput.trim()) return step.suggestions;
    const q = textInput.toLowerCase();
    return step.suggestions.filter((s) =>
      s.label.toLowerCase().includes(q) || (s.hint ?? '').toLowerCase().includes(q),
    );
  }, [step?.suggestions, textInput]);
  const clampedSuggestionIdx = Math.min(suggestionIndex, Math.max(0, filteredSuggestions.length - 1));

  const goToNextStep = (value: string) => {
    const newValues = { ...values, [step!.id]: value };
    setValues(newValues);
    textHook.reset('');
    setTaLines(['']);
    setTaCursorRow(0);
    setTaCursorCol(0);
    setSelectIndex(0);
    setMultiSelected(new Set());
    setBrowsingSuggestions(false);
    setSuggestionIndex(0);
    setDirty(false);
    setValidationError(null);
    setEnterBlockHint(false);
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);

    // Find next non-skipped step from FULL steps array using newValues
    // (activeSteps is stale — it was memoized with old values)
    const currentStepId = step!.id;
    const currentIdx = steps.findIndex((s) => s.id === currentStepId);
    let nextOrigIdx = currentIdx + 1;
    while (nextOrigIdx < steps.length) {
      const candidate = steps[nextOrigIdx];
      if (candidate && !candidate.skip?.(newValues)) break;
      nextOrigIdx++;
    }

    if (nextOrigIdx >= steps.length) {
      onComplete(newValues);
    } else {
      // Map back to active step index for rendering
      const nextStepId = steps[nextOrigIdx]!.id;
      const newActiveSteps = steps.filter((s) => !s.skip?.(newValues));
      const nextActiveIdx = newActiveSteps.findIndex((s) => s.id === nextStepId);
      setCurrentStep(nextActiveIdx >= 0 ? nextActiveIdx : 0);

      const nextStep = steps[nextOrigIdx]!;
      // Pre-fill defaults
      if (nextStep.type === 'text') {
        textHook.reset(nextStep.defaultValue ?? '');
      } else if (nextStep.type === 'textarea') {
        const lines = nextStep.defaultValue ? nextStep.defaultValue.split('\n') : [''];
        setTaLines(lines);
        setTaCursorRow(lines.length - 1);
        setTaCursorCol(lines[lines.length - 1]!.length);
      } else if (nextStep.type === 'select') {
        const opts = nextStep.getOptions?.(newValues) ?? nextStep.options ?? [];
        if (nextStep.defaultValue) {
          const idx = opts.findIndex((o) => o.value === nextStep.defaultValue);
          setSelectIndex(idx >= 0 ? idx : 0);
        } else {
          setSelectIndex(0);
        }
      } else if (nextStep.type === 'multiselect') {
        setSelectIndex(0);
        // Pre-select from comma-separated defaultValue
        if (nextStep.defaultValue) {
          setMultiSelected(new Set(nextStep.defaultValue.split(',')));
        } else {
          setMultiSelected(new Set());
        }
      }
    }
  };

  const goToPrevStep = () => {
    if (currentStep === 0) {
      onCancel();
      return;
    }
    // Find previous non-skipped step from full steps array
    const currentStepId = step!.id;
    const currentOrigIdx = steps.findIndex((s) => s.id === currentStepId);
    let prevOrigIdx = currentOrigIdx - 1;
    while (prevOrigIdx >= 0) {
      const candidate = steps[prevOrigIdx];
      if (candidate && !candidate.skip?.(values)) break;
      prevOrigIdx--;
    }
    if (prevOrigIdx < 0) {
      onCancel();
      return;
    }
    // Map to active step index
    const prevStepId = steps[prevOrigIdx]!.id;
    const prevActiveIdx = activeSteps.findIndex((s) => s.id === prevStepId);
    setCurrentStep(prevActiveIdx >= 0 ? prevActiveIdx : 0);
    setBrowsingSuggestions(false);
    setSuggestionIndex(0);
    setDirty(false);
    setValidationError(null);
    setEnterBlockHint(false);
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);

    const prevStep = steps[prevOrigIdx]!;
    // Restore previous value — mark dirty if value was previously entered
    const hasPrevValue = !!values[prevStep.id];
    if (hasPrevValue) setDirty(true);
    if (prevStep.type === 'text') {
      textHook.reset(values[prevStep.id] ?? prevStep.defaultValue ?? '');
    } else if (prevStep.type === 'textarea') {
      const val = values[prevStep.id] ?? prevStep.defaultValue ?? '';
      const lines = val ? val.split('\n') : [''];
      setTaLines(lines);
      setTaCursorRow(lines.length - 1);
      setTaCursorCol(lines[lines.length - 1]!.length);
    } else if (prevStep.type === 'multiselect') {
      setSelectIndex(0);
      const prevVal = values[prevStep.id];
      setMultiSelected(prevVal ? new Set(prevVal.split(',')) : new Set());
    } else {
      const prevOptions = prevStep.getOptions?.(values) ?? prevStep.options ?? [];
      const prevVal = values[prevStep.id];
      const idx = prevOptions.findIndex((o) => o.value === prevVal);
      setSelectIndex(idx >= 0 ? idx : 0);
    }
  };

  useInput((input, key) => {
    if (!step) return;

    // Esc: cancel wizard
    if (key.escape) {
      if (currentStep === 0) {
        onCancel();
      } else {
        goToPrevStep();
      }
      return;
    }

    // Ctrl+V / Cmd+V / Ctrl+I: paste image from clipboard (for text/textarea steps)
    if ((key.ctrl || key.meta) && (input === 'v' || input === 'i') && onPasteImage && (step.type === 'text' || step.type === 'textarea')) {
      onPasteImage();
      return;
    }

    if (step.type === 'text') {
      // Suggestion browsing mode (↓ entered the suggestion list)
      if (browsingSuggestions && filteredSuggestions.length > 0) {
        if (key.upArrow) {
          if (clampedSuggestionIdx <= 0) {
            setBrowsingSuggestions(false);
          } else {
            setSuggestionIndex((i) => i - 1);
          }
          return;
        }
        if (key.downArrow) {
          setSuggestionIndex((i) => Math.min(filteredSuggestions.length - 1, i + 1));
          return;
        }
        if (key.return) {
          const selected = filteredSuggestions[clampedSuggestionIdx];
          if (selected && onSuggestionSelected) {
            onSuggestionSelected(selected.value);
          }
          return;
        }
        // Any other key exits suggestion mode and processes normally
        setBrowsingSuggestions(false);
        // fall through to normal text handling below
      }

      // Enter: submit text step
      if (key.return) {
        const val = textInput.trim();
        if (step.required && !val) { setDirty(true); return; }
        if (validationError !== null) {
          setDirty(true);
          setEnterBlockHint(true);
          if (enterBlockTimerRef.current) clearTimeout(enterBlockTimerRef.current);
          enterBlockTimerRef.current = setTimeout(() => setEnterBlockHint(false), 2000);
          return;
        }
        goToNextStep(val);
        return;
      }
      // ↓ arrow: enter suggestion browsing
      if (key.downArrow && step.suggestions && filteredSuggestions.length > 0) {
        setBrowsingSuggestions(true);
        setSuggestionIndex(0);
        return;
      }
      // Backspace on empty field: go back
      if ((key.backspace || key.delete) && textHook.cursor.isEmpty && currentStep > 0) {
        goToPrevStep();
        return;
      }
      // Delegate all text editing to unified handler
      const consumed = textHook.handleInput(input, key);
      if (consumed) {
        setDirty(true);
        setBrowsingSuggestions(false);
        setSuggestionIndex(0);
      }
      return;
    }

    if (step.type === 'textarea') {
      // Ctrl+Enter / Cmd+Enter: confirm textarea
      if (key.return && (key.ctrl || key.meta)) {
        const val = taLines.join('\n').trim();
        if (step.required && !val) { setDirty(true); return; }
        if (validationError !== null) {
          setDirty(true);
          setEnterBlockHint(true);
          if (enterBlockTimerRef.current) clearTimeout(enterBlockTimerRef.current);
          enterBlockTimerRef.current = setTimeout(() => setEnterBlockHint(false), 2000);
          return;
        }
        goToNextStep(val);
        return;
      }
      // Enter (plain or Shift+Enter): insert newline
      if (key.return) {
        setDirty(true);
        setTaLines((lines) => {
          const line = lines[taCursorRow] ?? '';
          const before = line.slice(0, taCursorCol);
          const after = line.slice(taCursorCol);
          const newLines = [...lines];
          newLines.splice(taCursorRow, 1, before, after);
          return newLines;
        });
        setTaCursorRow((r) => r + 1);
        setTaCursorCol(0);
        return;
      }
      // Terminal shortcuts
      if (key.ctrl && input === 'a') { setTaCursorCol(0); return; }
      if (key.ctrl && input === 'e') { setTaCursorCol((taLines[taCursorRow] ?? '').length); return; }
      if (key.ctrl && input === 'k') {
        setDirty(true);
        setTaLines((lines) => {
          const newLines = [...lines];
          newLines[taCursorRow] = (newLines[taCursorRow] ?? '').slice(0, taCursorCol);
          return newLines;
        });
        return;
      }
      if (key.ctrl && input === 'u') {
        setDirty(true);
        setTaLines((lines) => {
          const newLines = [...lines];
          newLines[taCursorRow] = (newLines[taCursorRow] ?? '').slice(taCursorCol);
          return newLines;
        });
        setTaCursorCol(0);
        return;
      }
      if (key.ctrl && input === 'w') {
        setDirty(true);
        const row = taCursorRow;
        const col = taCursorCol;
        setTaLines((lines) => {
          const currentLine = lines[row] ?? '';
          const newPos = wordBoundaryBack(currentLine, col);
          const newLines = [...lines];
          newLines[row] = currentLine.slice(0, newPos) + currentLine.slice(col);
          setTaCursorCol(newPos);
          return newLines;
        });
        return;
      }
      // Option+Left / Meta+B: word backward
      if (key.meta && (key.leftArrow || input === 'b')) {
        setTaCursorCol(wordBoundaryBack(taLines[taCursorRow] ?? '', taCursorCol));
        return;
      }
      // Option+Right / Meta+F: word forward
      if (key.meta && (key.rightArrow || input === 'f')) {
        setTaCursorCol(wordBoundaryForward(taLines[taCursorRow] ?? '', taCursorCol));
        return;
      }
      // Arrow navigation (visual lines — accounts for word-wrap)
      if (key.upArrow) {
        if (taCursorVisualRow > 0) {
          const curVl = taVisualLines[taCursorVisualRow];
          const targetVl = taVisualLines[taCursorVisualRow - 1]!;
          const visualCol = taCursorCol - (curVl?.startCol ?? 0);
          const newCol = Math.min(targetVl.startCol + visualCol, targetVl.startCol + targetVl.text.length);
          setTaCursorRow(targetVl.logicalRow);
          setTaCursorCol(newCol);
        }
        return;
      }
      if (key.downArrow) {
        if (taCursorVisualRow < taVisualLines.length - 1) {
          const curVl = taVisualLines[taCursorVisualRow];
          const targetVl = taVisualLines[taCursorVisualRow + 1]!;
          const visualCol = taCursorCol - (curVl?.startCol ?? 0);
          const newCol = Math.min(targetVl.startCol + visualCol, targetVl.startCol + targetVl.text.length);
          setTaCursorRow(targetVl.logicalRow);
          setTaCursorCol(newCol);
        }
        return;
      }
      if (key.leftArrow) {
        if (taCursorCol > 0) {
          setTaCursorCol((c) => c - 1);
        } else if (taCursorRow > 0) {
          setTaCursorRow((r) => r - 1);
          setTaCursorCol((taLines[taCursorRow - 1] ?? '').length);
        }
        return;
      }
      if (key.rightArrow) {
        const lineLen = (taLines[taCursorRow] ?? '').length;
        if (taCursorCol < lineLen) {
          setTaCursorCol((c) => c + 1);
        } else if (taCursorRow < taLines.length - 1) {
          setTaCursorRow((r) => r + 1);
          setTaCursorCol(0);
        }
        return;
      }
      if (key.backspace || key.delete) {
        if (taCursorCol === 0 && taCursorRow === 0) {
          // At very start — do nothing (use Esc to go back)
          return;
        }
        if (taCursorCol > 0) {
          // Delete char before cursor
          setTaLines((lines) => {
            const newLines = [...lines];
            const line = newLines[taCursorRow] ?? '';
            newLines[taCursorRow] = line.slice(0, taCursorCol - 1) + line.slice(taCursorCol);
            return newLines;
          });
          setTaCursorCol((c) => c - 1);
        } else {
          // Merge with previous line
          const mergedCol = (taLines[taCursorRow - 1] ?? '').length;
          setTaLines((lines) => {
            const newLines = [...lines];
            const prevLine = newLines[taCursorRow - 1] ?? '';
            const curLine = newLines[taCursorRow] ?? '';
            newLines.splice(taCursorRow - 1, 2, prevLine + curLine);
            return newLines;
          });
          setTaCursorCol(mergedCol);
          setTaCursorRow((r) => r - 1);
        }
        return;
      }
      // Regular character input (handles paste with newlines)
      if (input && !key.ctrl && !key.meta && !key.escape) {
        setDirty(true);
        const parts = input.split(/\r?\n/);
        if (parts.length === 1) {
          // Single line — fast path
          setTaLines((lines) => {
            const newLines = [...lines];
            const line = newLines[taCursorRow] ?? '';
            newLines[taCursorRow] = line.slice(0, taCursorCol) + input + line.slice(taCursorCol);
            return newLines;
          });
          setTaCursorCol((c) => c + input.length);
        } else {
          // Multiline paste
          const row = taCursorRow;
          const col = taCursorCol;
          setTaLines((lines) => {
            const newLines = [...lines];
            const line = newLines[row] ?? '';
            const before = line.slice(0, col);
            const after = line.slice(col);
            const firstPart = parts[0] ?? '';
            const lastPart = parts[parts.length - 1] ?? '';
            const insertLines = [
              before + firstPart,
              ...parts.slice(1, -1),
              lastPart + after,
            ];
            newLines.splice(row, 1, ...insertLines);
            return newLines;
          });
          setTaCursorRow(row + parts.length - 1);
          setTaCursorCol((parts[parts.length - 1] ?? '').length);
        }
      }
      return;
    }

    // Shared navigation for select and multiselect
    if (step.type === 'select' || step.type === 'multiselect') {
      if (key.upArrow || input === 'k') {
        setSelectIndex((i) => Math.max(0, i - 1));
        return;
      }
      if (key.downArrow || input === 'j') {
        setSelectIndex((i) => Math.min(options.length - 1, i + 1));
        return;
      }
      if (key.backspace || key.delete) {
        goToPrevStep();
        return;
      }

      // Type-specific confirm and actions
      if (step.type === 'select') {
        if (key.return || key.tab) {
          const selected = options[clampedSelectIndex];
          if (selected) {
            if (step.validate) {
              const err = step.validate(selected.value);
              if (err !== null) {
                setDirty(true);
                setValidationError(err);
                setEnterBlockHint(true);
                if (enterBlockTimerRef.current) clearTimeout(enterBlockTimerRef.current);
                enterBlockTimerRef.current = setTimeout(() => setEnterBlockHint(false), 2000);
                return;
              }
            }
            goToNextStep(selected.value);
          }
          return;
        }
        // Number keys for quick selection
        if (input >= '1' && input <= '9') {
          const idx = parseInt(input, 10) - 1;
          if (idx < options.length) {
            const selected = options[idx];
            if (selected) goToNextStep(selected.value);
          }
          return;
        }
      } else {
        // Multiselect: Space toggle, Enter confirm
        if (input === ' ') {
          const opt = options[clampedSelectIndex];
          if (opt) {
            setMultiSelected((prev) => {
              const next = new Set(prev);
              if (next.has(opt.value)) {
                next.delete(opt.value);
              } else {
                next.add(opt.value);
              }
              return next;
            });
          }
          return;
        }
        if (key.return) {
          const selected = Array.from(multiSelected).join(',');
          goToNextStep(selected);
          return;
        }
      }
    }
  });

  if (!step) return null;

  // Only show validation errors visually after user has interacted (dirty)
  const visibleError = dirty ? validationError : null;
  const maxW = Math.max(20, width - 6);
  const progressText = `${currentStep + 1}/${totalSteps}`;

  // Visible height for options (subtract header lines)
  const optionsH = Math.max(2, height - 4);
  // Scroll options if needed
  let optScrollStart = 0;
  if (clampedSelectIndex >= optionsH) {
    optScrollStart = clampedSelectIndex - optionsH + 1;
  }
  const visibleOptions = options.slice(optScrollStart, optScrollStart + optionsH);

  return (
    <Box flexDirection="column" paddingX={2}>
      {/* Header: title + progress */}
      <Box>
        <Text color={tuiColors.amber} bold>{title}</Text>
        <Text color={tuiColors.ghost}>{' '}{LIGHT_RULE}{LIGHT_RULE}{' '}</Text>
        <Text color={tuiColors.dim}>step {progressText}</Text>
      </Box>

      {/* Progress dots */}
      <Box>
        <Text>  </Text>
        {activeSteps.map((s, i) => (
          <Text key={s.id} color={i === currentStep ? tuiColors.amber : i < currentStep ? tuiColors.green : tuiColors.ghost}>
            {i === currentStep ? '\u25CF' : i < currentStep ? '\u2713' : '\u25CB'}{' '}
          </Text>
        ))}
      </Box>

      {/* Step label */}
      <Box marginTop={0}>
        <Text color={tuiColors.white} bold>  {step.label}</Text>
        {step.required && <Text color={tuiColors.red}> *</Text>}
        {!step.required && <Text color={tuiColors.dim}> (optional, {step.type === 'textarea' ? `${CMD_KEY}+Enter` : 'Enter'} to skip)</Text>}
      </Box>

      {/* Step description / guidance */}
      {step.description && (
        <Box>
          <Text color={tuiColors.dim}>  {step.description}</Text>
        </Box>
      )}

      {/* Text input with cursor — unified component */}
      {step.type === 'text' && (
        <Box flexDirection="column" paddingLeft={2}>
          <TextInput
            cursor={textHook.cursor}
            width={maxW - 4}
            prefix={'> '}
            placeholder={step.placeholder}
            hasError={!!visibleError}
          />
          {visibleError && <Text color={tuiColors.red} dimColor>  {visibleError}</Text>}
          {enterBlockHint && <Text color={tuiColors.red}>  Fix the error above</Text>}
        </Box>
      )}

      {/* Suggestion list below text input */}
      {step.type === 'text' && step.suggestions && filteredSuggestions.length > 0 && (() => {
        const sugH = Math.max(2, height - 6);
        let sugScrollStart = 0;
        if (browsingSuggestions && clampedSuggestionIdx >= sugH) {
          sugScrollStart = clampedSuggestionIdx - sugH + 1;
        }
        const visibleSugs = filteredSuggestions.slice(sugScrollStart, sugScrollStart + sugH);
        return (
          <Box flexDirection="column">
            <Text color={tuiColors.ghost}>  {LIGHT_RULE}{LIGHT_RULE}{LIGHT_RULE} or browse templates {LIGHT_RULE.repeat(Math.max(0, maxW - 28))}</Text>
            {visibleSugs.map((sug, i) => {
              const realIdx = i + sugScrollStart;
              const isSelected = browsingSuggestions && realIdx === clampedSuggestionIdx;
              return (
                <Box key={sug.value}>
                  <Text color={isSelected ? tuiColors.amber : tuiColors.ghost}>
                    {isSelected ? '  \u25B8 ' : '    '}
                  </Text>
                  <Text color={isSelected ? tuiColors.white : tuiColors.silver} bold={isSelected}>
                    {sug.label}
                  </Text>
                  {sug.hint && (
                    <Text color={tuiColors.dim} wrap="truncate">{' '}{LIGHT_RULE} {sug.hint.replace(/\n/g, ' ')}</Text>
                  )}
                </Box>
              );
            })}
          </Box>
        );
      })()}

      {/* Textarea (multiline editor with visual wrapping) */}
      {step.type === 'textarea' && (() => {
        const taVisibleH = Math.max(3, height - 6);
        let taScrollStart = 0;
        if (taCursorVisualRow >= taVisibleH) {
          taScrollStart = taCursorVisualRow - taVisibleH + 1;
        }
        const visibleVLines = taVisualLines.slice(taScrollStart, taScrollStart + taVisibleH);
        return (
          <Box flexDirection="column">
            <Box flexDirection="column" borderStyle={visibleError ? 'round' : undefined} borderColor={visibleError ? tuiColors.red : undefined}>
              {visibleVLines.map((vl, i) => {
                const vRow = i + taScrollStart;
                const lineNum = vl.isFirst
                  ? String(vl.logicalRow + 1).padStart(taLineNumWidth, ' ')
                  : ''.padStart(taLineNumWidth, ' ');
                const isCursorLine = vRow === taCursorVisualRow;
                const cursorColInVisual = taCursorCol - vl.startCol;
                return (
                  <Box key={`${vl.logicalRow}-${vl.startCol}`}>
                    <Text color={tuiColors.dim}> {lineNum} </Text>
                    <Text color={tuiColors.ghost}>{'\u2502'} </Text>
                    {isCursorLine ? (
                      <>
                        <Text color={tuiColors.white}>{vl.text.slice(0, cursorColInVisual)}</Text>
                        <Text color={tuiColors.amber}>{CURSOR}</Text>
                        <Text color={tuiColors.white}>{vl.text.slice(cursorColInVisual)}</Text>
                      </>
                    ) : (
                      <Text color={tuiColors.silver}>{vl.text || (vl.isFirst ? ' ' : '')}</Text>
                    )}
                  </Box>
                );
              })}
              {/* Show placeholder on empty textarea */}
              {taLines.length === 1 && taLines[0] === '' && step.placeholder && (
                <Box>
                  <Text color={tuiColors.dim}>  {''.padStart(taLineNumWidth, ' ')}  {step.placeholder}</Text>
                </Box>
              )}
            </Box>
            {visibleError && <Text color={tuiColors.red} dimColor>  {visibleError}</Text>}
            {enterBlockHint && <Text color={tuiColors.red}>  Fix the error above</Text>}
          </Box>
        );
      })()}

      {/* Select list */}
      {step.type === 'select' && (
        <Box flexDirection="column">
          {visibleOptions.map((opt, i) => {
            const realIdx = i + optScrollStart;
            const isSelected = realIdx === clampedSelectIndex;
            const numLabel = String(realIdx + 1).padStart(options.length >= 10 ? 2 : 1);
            return (
              <Box key={opt.value}>
                <Text color={isSelected ? tuiColors.amber : tuiColors.ghost}>
                  {isSelected ? '  \u25B8 ' : `  ${numLabel} `}
                </Text>
                <Text color={isSelected ? tuiColors.white : tuiColors.silver} bold={isSelected}>
                  {opt.label}
                </Text>
                {opt.hint && (
                  <Text color={tuiColors.dim} wrap="truncate">{' '}{LIGHT_RULE} {opt.hint.replace(/\n/g, ' ')}</Text>
                )}
              </Box>
            );
          })}
          {visibleError && <Text color={tuiColors.red} dimColor>  {visibleError}</Text>}
          {enterBlockHint && <Text color={tuiColors.red}>  Fix the error above</Text>}
        </Box>
      )}

      {/* Multiselect list */}
      {step.type === 'multiselect' && (
        <Box flexDirection="column">
          {visibleOptions.map((opt, i) => {
            const realIdx = i + optScrollStart;
            const isSelected = realIdx === clampedSelectIndex;
            const isChecked = multiSelected.has(opt.value);
            return (
              <Box key={opt.value}>
                <Text color={isSelected ? tuiColors.amber : tuiColors.ghost}>
                  {isSelected ? '  \u25B8 ' : '    '}
                </Text>
                <Text color={isChecked ? tuiColors.green : tuiColors.dim}>
                  {isChecked ? '[\u2713]' : '[ ]'}
                </Text>
                <Text color={isSelected ? tuiColors.white : tuiColors.silver} bold={isSelected}>
                  {' '}{opt.label}
                </Text>
                {opt.hint && (
                  <Text color={tuiColors.dim} wrap="truncate">{' '}{LIGHT_RULE} {opt.hint.replace(/\n/g, ' ')}</Text>
                )}
              </Box>
            );
          })}
          {multiSelected.size > 0 && (
            <Box>
              <Text color={tuiColors.dim}>  {'\u2514'} {multiSelected.size} selected</Text>
            </Box>
          )}
        </Box>
      )}

      {/* Hint bar */}
      <Box marginTop={0}>
        <Text color={tuiColors.ghost}>
          {'  '}
          {step.type === 'select'
            ? '\u2191\u2193 select  Enter confirm'
            : step.type === 'multiselect'
              ? '\u2191\u2193 move  Space toggle  Enter confirm'
              : step.type === 'textarea'
                ? `Enter newline  ${CMD_KEY}+Enter confirm  \u2190\u2191\u2192\u2193 navigate`
                : browsingSuggestions
                  ? '\u2191\u2193 browse  Enter select  \u2191 back to input'
                  : step.suggestions
                    ? '\u2190\u2192 move  Enter confirm  \u2193 browse templates'
                    : '\u2190\u2192 move  Enter confirm'}
          {onPasteImage && (step.type === 'text' || step.type === 'textarea') ? `  ${CMD_KEY}+V paste image` : ''}
          {'  Esc '}
          {currentStep > 0 ? 'back' : 'cancel'}
        </Text>
        {footerExtra && <Text color={tuiColors.amber}>{'  '}{footerExtra}</Text>}
      </Box>
    </Box>
  );
}
