import React from 'react';
import type { ShellCommand } from './desktop-shell-model';

interface CommandPaletteProps {
  commands: readonly ShellCommand[];
  title: string;
  searchLabel: string;
  noCommands: string;
  keyboardHint: string;
  onRun: (command: ShellCommand) => void;
  onClose: () => void;
}

export function CommandPalette({ commands, title, searchLabel, noCommands, keyboardHint, onRun, onClose }: CommandPaletteProps) {
  const id = React.useId();
  const dialog = React.useRef<HTMLDialogElement>(null);
  const input = React.useRef<HTMLInputElement>(null);
  const activeOption = React.useRef<HTMLDivElement>(null);
  const [query, setQuery] = React.useState('');
  const [index, setIndex] = React.useState(0);
  const words = query.trim().toLocaleLowerCase().split(/\s+/u);
  const filtered = commands.filter(command => {
    if (command.available === false) return false;
    const searchable = [command.id.replaceAll('-', ' '), command.label, command.description, ...(command.keywords ?? [])].join(' ').toLocaleLowerCase();
    return words.every(word => searchable.includes(word));
  }).slice(0, 20);
  const activeIndex = Math.min(index, filtered.length - 1);

  React.useLayoutEffect(() => {
    const element = dialog.current!;
    element.showModal();
    input.current?.focus();
    return () => element.close();
  }, []);

  React.useEffect(() => {
    activeOption.current?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, query]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (filtered.length) setIndex((activeIndex + (event.key === 'ArrowDown' ? 1 : -1) + filtered.length) % filtered.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const command = filtered[activeIndex];
      if (command) onRun(command);
    }
  };

  return <dialog
    ref={dialog}
    className="command-palette"
    aria-label={title}
    onCancel={event => { event.preventDefault(); onClose(); }}
    onClick={event => {
      if (event.target !== event.currentTarget) return;
      const { left, top, right, bottom } = event.currentTarget.getBoundingClientRect();
      if (event.clientX < left || event.clientX > right || event.clientY < top || event.clientY > bottom) onClose();
    }}
  >
    <div className="palette-input">
      <input
        ref={input}
        value={query}
        onChange={event => { setQuery(event.target.value); setIndex(0); }}
        onKeyDown={onKeyDown}
        placeholder={searchLabel}
        aria-label={searchLabel}
        aria-describedby={`${id}-hint`}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded="true"
        aria-controls={`${id}-list`}
        aria-activedescendant={activeIndex >= 0 ? `${id}-${activeIndex}` : undefined}
      />
      <kbd aria-hidden="true">Esc</kbd>
    </div>
    <div className="palette-list" id={`${id}-list`} role="listbox" aria-label={title}>
      {filtered.map((command, position) => <div
        key={command.id}
        ref={position === activeIndex ? activeOption : undefined}
        id={`${id}-${position}`}
        role="option"
        aria-selected={position === activeIndex}
        className={position === activeIndex ? 'palette-command selected' : 'palette-command'}
        onPointerMove={() => setIndex(position)}
        onClick={() => onRun(command)}
      >
        <strong>{command.label}</strong>
        {command.description && <small>{command.description}</small>}
      </div>)}
    </div>
    {filtered.length === 0 && <p className="palette-empty" role="status">{noCommands}</p>}
    <footer id={`${id}-hint`}>{keyboardHint}</footer>
  </dialog>;
}
