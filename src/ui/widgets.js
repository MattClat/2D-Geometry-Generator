/* =========================================================================
 * widgets.js — the small, reusable control primitives
 * =======================================================================*/
import h, { cx, useState, useRef, useEffect, useCallback } from '../lib/h.js';

export function Button({ children, onClick, variant = 'ghost', size = 'md', title, disabled, active, className, ariaLabel }) {
  return h('button', {
    className: cx('btn', `btn-${variant}`, `btn-${size}`, active && 'is-active', className),
    onClick, title, disabled, type: 'button',
    // icon-only buttons have a glyph for a label; give screen readers the title
    'aria-label': ariaLabel || title || undefined,
    'aria-pressed': active === undefined ? undefined : !!active,
  }, children);
}

export function IconButton(props) {
  return h(Button, { ...props, className: cx('btn-icon', props.className) });
}

/** Numeric slider with an editable value box and scrub-on-label. */
export function Slider({ label, value, min, max, step = 0.01, unit, int, onChange, disabled }) {
  const [text, setText] = useState(null);
  const fmt = (v) => (int ? String(Math.round(v)) : String(Math.round(v * 1000) / 1000));
  const clamp = (v) => Math.max(min, Math.min(max, v));
  const pct = ((value - min) / (max - min || 1)) * 100;
  return h('div', { className: cx('ctl', disabled && 'is-disabled') },
    h('div', { className: 'ctl-head' },
      h('label', { className: 'ctl-label' }, label),
      h('input', {
        className: 'ctl-num',
        value: text !== null ? text : fmt(value),
        onChange: (e) => setText(e.target.value),
        onBlur: (e) => {
          const v = parseFloat(e.target.value);
          if (isFinite(v)) onChange(clamp(int ? Math.round(v) : v));
          setText(null);
        },
        onKeyDown: (e) => { if (e.key === 'Enter') e.target.blur(); },
        disabled,
        'aria-label': `${label} value`,
        inputMode: 'decimal',
      }),
      unit ? h('span', { className: 'ctl-unit' }, unit) : null,
    ),
    h('input', {
      type: 'range', className: 'ctl-range', min, max, step, value, disabled,
      style: { '--pct': pct + '%' },
      'aria-label': label,
      onChange: (e) => onChange(parseFloat(e.target.value)),
    }),
  );
}

export function Toggle({ label, value, onChange, disabled, hint }) {
  return h('div', { className: cx('ctl ctl-toggle', disabled && 'is-disabled') },
    h('label', { className: 'ctl-label', title: hint }, label),
    h('button', {
      type: 'button',
      className: cx('switch', value && 'is-on'),
      onClick: () => !disabled && onChange(!value),
      role: 'switch',
      'aria-checked': !!value,
      'aria-label': label,
      disabled,
    }, h('span', { className: 'switch-knob' })),
  );
}

export function Select({ label, value, options, onChange, disabled }) {
  return h('div', { className: cx('ctl', disabled && 'is-disabled') },
    label ? h('label', { className: 'ctl-label' }, label) : null,
    h('div', { className: 'select-wrap' },
      h('select', {
        className: 'select', value, disabled,
        'aria-label': label || undefined,
        onChange: (e) => onChange(e.target.value),
      }, options.map((o) => h('option', { key: o.v, value: o.v }, o.label))),
      h('span', { className: 'select-caret' }, '▾'),
    ),
  );
}

export function SegmentedControl({ value, options, onChange, className }) {
  return h('div', { className: cx('segmented', className) },
    options.map((o) => h('button', {
      key: o.v, type: 'button',
      className: cx('seg', value === o.v && 'is-active'),
      onClick: () => onChange(o.v),
      title: o.title,
    }, o.label)),
  );
}

export function Section({ title, children, defaultOpen = true, right, dense }) {
  const [open, setOpen] = useState(defaultOpen);
  return h('section', { className: cx('panel-section', dense && 'is-dense') },
    h('header', { className: 'panel-head', onClick: () => setOpen(!open) },
      h('span', { className: cx('disclosure', open && 'is-open') }, '▸'),
      h('h3', null, title),
      right ? h('div', { className: 'panel-head-right', onClick: (e) => e.stopPropagation() }, right) : null,
    ),
    open ? h('div', { className: 'panel-body' }, children) : null,
  );
}

export function Stat({ label, value, unit, tone, wide }) {
  return h('div', { className: cx('stat', tone && `stat-${tone}`, wide && 'stat-wide') },
    h('div', { className: 'stat-value' }, value, unit ? h('span', { className: 'stat-unit' }, unit) : null),
    h('div', { className: 'stat-label' }, label),
  );
}

/** Renders one parameter from an engine/modifier schema. */
export function SchemaControl({ spec, value, onChange, disabled }) {
  if (spec.type === 'toggle') {
    return h(Toggle, { label: spec.label, value: !!value, onChange, disabled });
  }
  if (spec.type === 'select') {
    return h(Select, { label: spec.label, value, options: spec.options, onChange, disabled });
  }
  return h(Slider, {
    label: spec.label, value: Number(value), min: spec.min, max: spec.max,
    step: spec.step, unit: spec.unit, int: spec.int, onChange, disabled,
  });
}

/** Compact toast/notice strip. */
export function Notice({ tone = 'info', children, onDismiss }) {
  return h('div', { className: cx('notice', `notice-${tone}`) },
    h('div', { className: 'notice-body' }, children),
    onDismiss ? h('button', { className: 'notice-x', onClick: onDismiss, type: 'button' }, '×') : null,
  );
}
