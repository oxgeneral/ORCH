/**
 * TUI FormWizard — generic multi-step form with text inputs and selectable lists.
 *
 * Reusable for agent creation, task creation, or any multi-step form.
 * Each step can be a free text input or a selection from a list.
 *
 * Navigation: ↑↓ select items, Tab/Enter confirm step, Esc cancel, Backspace go back.
 */

import React, { useState, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import { tuiColors, LIGHT_RULE } from '../colors.js';

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
  required?: boolean;
  defaultValue?: string;
  /** Skip this step based on previous values */
  skip?: (values: Record<string, string>) => boolean;
}

export interface FormWizardProps {
  title: string;
  steps: WizardStep[];
  onComplete: (values: Record<string, string>) => void;
  onCancel: () => void;
  width: number;
  height: number;
}

const CURSOR = '\u2588'; // █

export function FormWizard({ title, steps, onComplete, onCancel, width, height }: FormWizardProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [values, setValues] = useState<Record<string, string>>({});
  const [textInput, setTextInput] = useState(() => {
    // Pre-fill first text step with default
    const firstActive = steps.find((s) => !s.skip?.({}));
    return firstActive?.type === 'text' && firstActive.defaultValue ? firstActive.defaultValue : '';
  });
  // Cursor position for single-line text input
  const [cursorPos, setCursorPos] = useState(() => {
    const firstActive = steps.find((s) => !s.skip?.({}));
    return firstActive?.type === 'text' && firstActive.defaultValue ? firstActive.defaultValue.length : 0;
  });
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

  // Multiselect toggled values (set of selected option values)
  const [multiSelected, setMultiSelected] = useState<Set<string>>(new Set());

  // Resolve options for current select/multiselect step
  const options = useMemo(() => {
    if (!step || (step.type !== 'select' && step.type !== 'multiselect')) return [];
    return step.getOptions?.(values) ?? step.options ?? [];
  }, [step, values]);

  // Clamp selectIndex when options change
  const clampedSelectIndex = Math.min(selectIndex, Math.max(0, options.length - 1));

  const goToNextStep = (value: string) => {
    const newValues = { ...values, [step!.id]: value };
    setValues(newValues);
    setTextInput('');
    setCursorPos(0);
    setTaLines(['']);
    setTaCursorRow(0);
    setTaCursorCol(0);
    setSelectIndex(0);
    setMultiSelected(new Set());

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
        const def = nextStep.defaultValue ?? '';
        setTextInput(def);
        setCursorPos(def.length);
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

    const prevStep = steps[prevOrigIdx]!;
    // Restore previous value
    if (prevStep.type === 'text') {
      const val = values[prevStep.id] ?? prevStep.defaultValue ?? '';
      setTextInput(val);
      setCursorPos(val.length);
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

    if (step.type === 'text') {
      if (key.return) {
        const val = textInput.trim();
        if (step.required && !val) return;
        goToNextStep(val);
        return;
      }
      if (key.leftArrow) {
        setCursorPos((p) => Math.max(0, p - 1));
        return;
      }
      if (key.rightArrow) {
        setCursorPos((p) => Math.min(textInput.length, p + 1));
        return;
      }
      if (key.backspace || key.delete) {
        if (cursorPos === 0 && textInput.length === 0 && currentStep > 0) {
          goToPrevStep();
          return;
        }
        if (cursorPos > 0) {
          setTextInput((v) => v.slice(0, cursorPos - 1) + v.slice(cursorPos));
          setCursorPos((p) => p - 1);
        }
        return;
      }
      if (input && !key.ctrl && !key.meta && !key.escape) {
        setTextInput((v) => v.slice(0, cursorPos) + input + v.slice(cursorPos));
        setCursorPos((p) => p + input.length);
      }
      return;
    }

    if (step.type === 'textarea') {
      // Enter (without shift): confirm textarea
      if (key.return && !key.shift) {
        const val = taLines.join('\n').trim();
        if (step.required && !val) return;
        goToNextStep(val);
        return;
      }
      // Shift+Enter: new line
      if (key.return && key.shift) {
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
      // Arrow navigation
      if (key.upArrow) {
        if (taCursorRow > 0) {
          setTaCursorRow((r) => r - 1);
          setTaCursorCol((c) => Math.min(c, (taLines[taCursorRow - 1] ?? '').length));
        }
        return;
      }
      if (key.downArrow) {
        if (taCursorRow < taLines.length - 1) {
          setTaCursorRow((r) => r + 1);
          setTaCursorCol((c) => Math.min(c, (taLines[taCursorRow + 1] ?? '').length));
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
          // At very start — if empty, go back
          if (taLines.length === 1 && taLines[0] === '' && currentStep > 0) {
            goToPrevStep();
          }
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
          setTaLines((lines) => {
            const newLines = [...lines];
            const prevLine = newLines[taCursorRow - 1] ?? '';
            const curLine = newLines[taCursorRow] ?? '';
            const mergedCol = prevLine.length;
            newLines.splice(taCursorRow - 1, 2, prevLine + curLine);
            // We'll set col in the next setState
            setTimeout(() => setTaCursorCol(mergedCol), 0);
            return newLines;
          });
          setTaCursorRow((r) => r - 1);
        }
        return;
      }
      // Regular character input
      if (input && !key.ctrl && !key.meta && !key.escape) {
        setTaLines((lines) => {
          const newLines = [...lines];
          const line = newLines[taCursorRow] ?? '';
          newLines[taCursorRow] = line.slice(0, taCursorCol) + input + line.slice(taCursorCol);
          return newLines;
        });
        setTaCursorCol((c) => c + input.length);
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
          if (selected) goToNextStep(selected.value);
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
        {!step.required && <Text color={tuiColors.dim}> (optional, Enter to skip)</Text>}
      </Box>

      {/* Text input with cursor */}
      {step.type === 'text' && (
        <Box>
          <Text color={tuiColors.amber}>  {'>'} </Text>
          {textInput.length > 0 ? (
            <>
              <Text color={tuiColors.white}>{textInput.slice(0, cursorPos)}</Text>
              <Text color={tuiColors.amber}>{CURSOR}</Text>
              <Text color={tuiColors.white}>{textInput.slice(cursorPos)}</Text>
            </>
          ) : step.placeholder ? (
            <>
              <Text color={tuiColors.ghost}>{step.placeholder}</Text>
              <Text color={tuiColors.amber}>{CURSOR}</Text>
            </>
          ) : (
            <Text color={tuiColors.amber}>{CURSOR}</Text>
          )}
        </Box>
      )}

      {/* Textarea (multiline editor) */}
      {step.type === 'textarea' && (() => {
        const taVisibleH = Math.max(3, height - 6);
        let taScrollStart = 0;
        if (taCursorRow >= taVisibleH) {
          taScrollStart = taCursorRow - taVisibleH + 1;
        }
        const visibleLines = taLines.slice(taScrollStart, taScrollStart + taVisibleH);
        const lineNumWidth = String(taLines.length).length;
        return (
          <Box flexDirection="column">
            {visibleLines.map((line, i) => {
              const realRow = i + taScrollStart;
              const lineNum = String(realRow + 1).padStart(lineNumWidth, ' ');
              const isCursorLine = realRow === taCursorRow;
              return (
                <Box key={realRow}>
                  <Text color={tuiColors.dim}> {lineNum} </Text>
                  <Text color={tuiColors.ghost}>{'\u2502'} </Text>
                  {isCursorLine ? (
                    <>
                      <Text color={tuiColors.white}>{line.slice(0, taCursorCol)}</Text>
                      <Text color={tuiColors.amber}>{CURSOR}</Text>
                      <Text color={tuiColors.white}>{line.slice(taCursorCol)}</Text>
                    </>
                  ) : (
                    <Text color={tuiColors.silver}>{line || ' '}</Text>
                  )}
                </Box>
              );
            })}
            {/* Show placeholder on empty textarea */}
            {taLines.length === 1 && taLines[0] === '' && step.placeholder && (
              <Box>
                <Text color={tuiColors.dim}>  {''.padStart(lineNumWidth, ' ')}  {step.placeholder}</Text>
              </Box>
            )}
          </Box>
        );
      })()}

      {/* Select list */}
      {step.type === 'select' && (
        <Box flexDirection="column">
          {visibleOptions.map((opt, i) => {
            const realIdx = i + optScrollStart;
            const isSelected = realIdx === clampedSelectIndex;
            const numLabel = realIdx < 9 ? `${realIdx + 1}` : ' ';
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
                ? 'Shift+Enter newline  Enter confirm  \u2190\u2191\u2192\u2193 navigate'
                : '\u2190\u2192 move  Enter confirm'}
          {'  Esc '}
          {currentStep > 0 ? 'back' : 'cancel'}
        </Text>
      </Box>
    </Box>
  );
}
