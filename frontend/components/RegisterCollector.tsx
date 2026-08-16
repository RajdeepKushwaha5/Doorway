'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Sparkle } from '@phosphor-icons/react';
import { registerCollectorAction, type ActionResult } from '@/app/actions';

/**
 * Register a Scraper Studio collector.
 *
 * The dashboard used to say "register a collector to begin" and offer no way
 * to do it, so the first thing a new operator was told to do was the one thing
 * the interface could not perform. The action existed; nothing called it.
 *
 * The field list is not a formality. NOTICE cannot verify anything until it
 * knows what each field is supposed to mean in plain words, because that same
 * sentence is what the witness matches on and what Bright Data repairs
 * against. So the form asks for the meaning rather than a selector, and the
 * example fills in a working set rather than leaving someone to guess the
 * shape.
 */

interface FieldSpec {
  path: string;
  meaning: string;
  labels: string;
  excludeLabels: string;
  kind: 'money' | 'number' | 'text';
}

const BLANK_FIELD: FieldSpec = {
  path: '',
  meaning: '',
  labels: '',
  excludeLabels: '',
  kind: 'text',
};

/** The DriftMart fixture, which is what most first runs point at. */
const EXAMPLE = {
  name: 'DriftMart headphones',
  targetDomain: 'driftmart-3ut8.onrender.com',
  watchUrl: 'https://driftmart-3ut8.onrender.com/product/headphones',
  fields: [
    {
      path: 'name',
      meaning: 'The product name as shown to a shopper, not a sponsored or recommended item.',
      labels: 'nova, headphones',
      excludeLabels: 'sponsored, recommended',
      kind: 'text' as const,
    },
    {
      path: 'price',
      meaning:
        'The purchase price of the product, not a refundable deposit, shipping fee or sponsored listing price.',
      labels: 'price, purchase price',
      excludeLabels: 'deposit, refundable, security, sponsored',
      kind: 'money' as const,
    },
    {
      path: 'availability',
      meaning: 'Whether the product can be bought right now.',
      labels: 'availability, stock',
      excludeLabels: '',
      kind: 'text' as const,
    },
  ],
};

const split = (value: string): string[] =>
  value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');

export function RegisterCollector() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);

  const [collectorId, setCollectorId] = useState('');
  const [name, setName] = useState('');
  const [domain, setDomain] = useState('');
  const [watchUrl, setWatchUrl] = useState('');
  const [fields, setFields] = useState<FieldSpec[]>([{ ...BLANK_FIELD }]);

  const fillExample = (): void => {
    setCollectorId('');
    setName(EXAMPLE.name);
    setDomain(EXAMPLE.targetDomain);
    setWatchUrl(EXAMPLE.watchUrl);
    setFields(EXAMPLE.fields.map((field) => ({ ...field })));
    setResult(null);
  };

  const submit = (): void => {
    setResult(null);
    startTransition(async () => {
      const outcome = await registerCollectorAction({
        brightDataCollectorId: collectorId.trim(),
        name: name.trim(),
        targetDomain: domain.trim(),
        watchUrls: [watchUrl.trim()],
        witnessSpecs: fields
          .filter((field) => field.path.trim() !== '')
          .map((field) => ({
            path: field.path.trim(),
            meaning: field.meaning.trim(),
            labels: split(field.labels),
            excludeLabels: split(field.excludeLabels),
            kind: field.kind,
            allowed: [],
          })),
        // A field that must exist on every row. Chosen rather than inferred:
        // NOTICE never invents an invariant from observed data, because a
        // rule learned from a broken run protects nothing.
        invariants: fields
          .filter((field) => field.path.trim() !== '')
          .map((field) => ({ kind: 'required' as const, field: field.path.trim() })),
        protectedFields: fields
          .filter((field) => field.path.trim() !== '')
          .map((field) => field.path.trim()),
        goldenCases: [],
        schedule: null,
      });

      setResult(outcome);
      if (outcome.ok) {
        setOpen(false);
        router.refresh();
      }
    });
  };

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="primary-button">
        Register a collector <Plus size={18} weight="bold" />
      </button>
    );
  }

  return (
    <div className="panel w-full max-w-3xl p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="eyebrow">Register</p>
          <h3 className="mt-2 text-xl font-medium">A collector you already built in Scraper Studio</h3>
        </div>
        <button type="button" onClick={fillExample} className="secondary-button whitespace-nowrap">
          Use the DriftMart example <Sparkle size={16} />
        </button>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <Field
          label="Collector id"
          hint="The c_... string from Scraper Studio"
          value={collectorId}
          onChange={setCollectorId}
          placeholder="c_abc123"
        />
        <Field label="Name" hint="How it appears here" value={name} onChange={setName} placeholder="DriftMart headphones" />
        <Field label="Domain" hint="Host it scrapes" value={domain} onChange={setDomain} placeholder="example.com" />
        <Field
          label="URL to watch"
          hint="The page observed on every run"
          value={watchUrl}
          onChange={setWatchUrl}
          placeholder="https://example.com/product/thing"
        />
      </div>

      <div className="mt-8">
        <p className="eyebrow">Fields to verify</p>
        <p className="mt-2 max-w-2xl text-sm text-muted">
          Describe each field the way you would explain it to a person. The witness matches on this
          sentence, and Bright Data repairs against it, so a vague description produces a vague
          repair.
        </p>

        <div className="mt-4 space-y-4">
          {fields.map((field, index) => (
            <div key={index} className="border border-surface-border bg-surface-soft p-4">
              <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
                <Field
                  label="Field name"
                  value={field.path}
                  onChange={(value) => update(setFields, index, { path: value })}
                  placeholder="price"
                />
                <label className="text-sm">
                  <span className="eyebrow block">Kind</span>
                  <select
                    value={field.kind}
                    onChange={(event) =>
                      update(setFields, index, { kind: event.target.value as FieldSpec['kind'] })
                    }
                    className="mt-2 border border-surface-border bg-surface p-2 text-sm"
                  >
                    <option value="text">text</option>
                    <option value="money">money</option>
                    <option value="number">number</option>
                  </select>
                </label>
              </div>
              <Field
                label="What it means"
                value={field.meaning}
                onChange={(value) => update(setFields, index, { meaning: value })}
                placeholder="The purchase price, not a refundable deposit."
              />
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <Field
                  label="Words that indicate it"
                  hint="Comma separated"
                  value={field.labels}
                  onChange={(value) => update(setFields, index, { labels: value })}
                  placeholder="price, purchase price"
                />
                <Field
                  label="Words that mean the opposite"
                  hint="Comma separated"
                  value={field.excludeLabels}
                  onChange={(value) => update(setFields, index, { excludeLabels: value })}
                  placeholder="deposit, refundable"
                />
              </div>
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={() => setFields((current) => [...current, { ...BLANK_FIELD }])}
          className="mt-4 text-sm underline underline-offset-4"
        >
          Add another field
        </button>
      </div>

      {result !== null && !result.ok ? (
        <p className="mt-6 border border-blocked/40 bg-blocked/10 p-4 text-sm text-blocked">
          {result.error}
        </p>
      ) : null}

      <div className="mt-8 flex flex-wrap gap-3">
        <button type="button" onClick={submit} disabled={pending} className="primary-button">
          {pending ? 'Registering...' : 'Register collector'}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="secondary-button">
          Cancel
        </button>
      </div>
    </div>
  );
}

function update(
  setFields: React.Dispatch<React.SetStateAction<FieldSpec[]>>,
  index: number,
  patch: Partial<FieldSpec>,
): void {
  setFields((current) =>
    current.map((field, position) => (position === index ? { ...field, ...patch } : field)),
  );
}

function Field({
  label,
  hint,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="mt-3 block text-sm">
      <span className="eyebrow block">
        {label}
        {hint === undefined ? '' : ` · ${hint}`}
      </span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="mt-2 w-full border border-surface-border bg-surface p-2 text-sm text-ivory placeholder:text-muted/60"
      />
    </label>
  );
}
