"use client";

import { useRef, useState } from "react";
import { search } from "@/lib/api";
import { useEscapeKey } from "@/hooks/useEscapeKey";
import type { OperationType, SearchOperation, DatumKind } from "@/types/search";
import { AlertTriangle, Shield, Users, Eye, MapPin, ChevronLeft, ChevronRight, Plus, Trash2, X, Check, Info, Camera } from "lucide-react";
import { LocationLookup } from "./LocationLookup";

interface Draft {
  name: string;
  type: OperationType;
  subjectName: string;
  subjectAge: string;
  subjectDesc: string;
  // Held locally until after the op is created (needs op ID for upload).
  subjectPhoto: File | null;
  subjectPhotoPreview: string | null;
  primaryLat: string;
  primaryLon: string;
  primaryLabel: string;
  secondaryDatums: Array<{ label: string; kind: DatumKind; lat: string; lon: string; notes: string }>;
  weatherNotes: string;
}

const TYPES: { value: OperationType; label: string; desc: string; icon: React.ReactNode }[] = [
  { value: "missing_person", label: "Missing Person", desc: "Locate an individual reported missing.", icon: <AlertTriangle size={18} className="text-red-400" /> },
  { value: "security_sweep", label: "Security Sweep", desc: "Clear an area of threats or hazards.", icon: <Shield size={18} className="text-amber-400" /> },
  { value: "event_patrol", label: "Event Patrol", desc: "Ongoing patrol of a venue or event.", icon: <Users size={18} className="text-blue-400" /> },
  { value: "welfare_check", label: "Welfare Check", desc: "Locate and assess welfare of a person.", icon: <Eye size={18} className="text-green-400" /> },
  { value: "custom", label: "Custom", desc: "Other search type.", icon: <MapPin size={18} className="text-fg-4" /> },
];

const KIND_OPTIONS: { value: DatumKind; label: string }[] = [
  { value: "lkp", label: "LKP — Last Known Position" },
  { value: "plp", label: "PLP — Possible Location" },
  { value: "sighting", label: "Sighting" },
  { value: "witness", label: "Witness location" },
  { value: "other", label: "Other" },
];

export function IncidentWizard({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (op: SearchOperation) => void;
}) {
  useEscapeKey(onClose);
  const [step, setStep] = useState(1);
  const [draft, setDraft] = useState<Draft>({
    name: "",
    type: "missing_person",
    subjectName: "",
    subjectAge: "",
    subjectDesc: "",
    subjectPhoto: null,
    subjectPhotoPreview: null,
    primaryLat: "",
    primaryLon: "",
    primaryLabel: "Last known position",
    secondaryDatums: [],
    weatherNotes: "",
  });
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const photoInputRef = useRef<HTMLInputElement | null>(null);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const pickPhoto = (file: File | null) => {
    setDraft((d) => {
      if (d.subjectPhotoPreview) URL.revokeObjectURL(d.subjectPhotoPreview);
      return {
        ...d,
        subjectPhoto: file,
        subjectPhotoPreview: file ? URL.createObjectURL(file) : null,
      };
    });
  };

  const totalSteps = 4;
  const canAdvance = (() => {
    if (step === 1) return draft.name.trim().length > 0;
    if (step === 2 && draft.type === "missing_person") return true; // subject optional
    if (step === 3) {
      if (!draft.primaryLat || !draft.primaryLon) return true; // datum optional, can add later
      const lat = parseFloat(draft.primaryLat);
      const lon = parseFloat(draft.primaryLon);
      return !isNaN(lat) && !isNaN(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
    }
    return true;
  })();

  const addSecondary = () =>
    setDraft((d) => ({
      ...d,
      secondaryDatums: [
        ...d.secondaryDatums,
        { label: "", kind: "plp", lat: "", lon: "", notes: "" },
      ],
    }));
  const removeSecondary = (i: number) =>
    setDraft((d) => ({ ...d, secondaryDatums: d.secondaryDatums.filter((_, j) => j !== i) }));
  const updateSecondary = (i: number, patch: Partial<Draft["secondaryDatums"][0]>) =>
    setDraft((d) => ({
      ...d,
      secondaryDatums: d.secondaryDatums.map((s, j) => (j === i ? { ...s, ...patch } : s)),
    }));

  const submit = async () => {
    setCreating(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { name: draft.name.trim(), type: draft.type };
      if (draft.primaryLat && draft.primaryLon) {
        body.datum_lat = parseFloat(draft.primaryLat);
        body.datum_lon = parseFloat(draft.primaryLon);
      }
      if (draft.type === "missing_person" && draft.subjectName) {
        body.subject_info = {
          name: draft.subjectName,
          age: draft.subjectAge ? parseInt(draft.subjectAge) : undefined,
          description: draft.subjectDesc || undefined,
        };
      }
      if (draft.weatherNotes) body.weather_notes = draft.weatherNotes;

      const op = (await search.createOperation(body)) as SearchOperation;

      // Upload subject photo if present (best effort — op exists either way).
      if (draft.subjectPhoto) {
        try {
          const form = new FormData();
          form.append("photo", draft.subjectPhoto);
          const resp = await fetch(`/api/search/operations/${op.id}/subject/photo`, {
            method: "POST",
            body: form,
            credentials: "include",
          });
          if (resp.ok) {
            const { photo_url } = await resp.json();
            op.subject_info = { ...(op.subject_info || { name: "" }), photo_url };
          }
        } catch {}
      }

      // Add secondary datums (best effort)
      for (const sd of draft.secondaryDatums) {
        if (!sd.lat || !sd.lon) continue;
        const lat = parseFloat(sd.lat);
        const lon = parseFloat(sd.lon);
        if (isNaN(lat) || isNaN(lon)) continue;
        try {
          await search.createDatum(op.id, {
            label: sd.label || "Datum",
            kind: sd.kind,
            lat,
            lon,
            notes: sd.notes || undefined,
          });
        } catch {}
      }

      if (draft.subjectPhotoPreview) URL.revokeObjectURL(draft.subjectPhotoPreview);
      onCreated(op);
    } catch (err: any) {
      setError(err?.message || "Failed to create operation");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[2000] flex items-end md:items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-surface-800 border border-surface-600 rounded-t-2xl md:rounded-xl w-full max-w-2xl max-h-[92vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-surface-700">
          <div>
            <h2 className="text-lg font-semibold">New Incident</h2>
            <p className="text-xs text-fg-4">Step {step} of {totalSteps}</p>
          </div>
          <button onClick={onClose} className="text-fg-4 hover:text-fg-1" aria-label="Close">
            <X size={18} />
          </button>
        </div>

        {/* Progress bar */}
        <div className="h-1 bg-surface-700">
          <div
            className="h-full bg-accent transition-all"
            style={{ width: `${(step / totalSteps) * 100}%` }}
          />
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {step === 1 && (
            <div className="space-y-5">
              <div>
                <label className="block text-xs text-fg-4 mb-2 uppercase tracking-wider">Incident Type</label>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {TYPES.map((t) => (
                    <button
                      key={t.value}
                      onClick={() => set("type", t.value)}
                      className={`flex items-start gap-2 p-3 rounded border text-left transition ${
                        draft.type === t.value
                          ? "border-accent bg-accent/10"
                          : "border-surface-600 bg-surface-700/50 hover:bg-surface-700"
                      }`}
                    >
                      <div className="mt-0.5">{t.icon}</div>
                      <div>
                        <div className="text-sm font-medium">{t.label}</div>
                        <div className="text-[11px] text-fg-4">{t.desc}</div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs text-fg-4 mb-1">Operation name</label>
                <input
                  value={draft.name}
                  onChange={(e) => set("name", e.target.value)}
                  placeholder={
                    draft.type === "missing_person"
                      ? "e.g. Missing Person — Ayr Beach, J. Smith"
                      : "e.g. Security Sweep — Pavilion East"
                  }
                  className="w-full px-3 py-2 bg-surface-700 border border-surface-600 rounded text-sm focus:outline-none focus:border-accent"
                  autoFocus
                />
                <p className="text-[10px] text-fg-4 mt-1">A concise identifier used in comms and reports.</p>
              </div>

              <div>
                <label className="block text-xs text-fg-4 mb-1">Weather / conditions notes (optional)</label>
                <textarea
                  value={draft.weatherNotes}
                  onChange={(e) => set("weatherNotes", e.target.value)}
                  rows={2}
                  placeholder="Fog patches, high tide at 19:40, rain from 21:00…"
                  className="w-full px-3 py-2 bg-surface-700 border border-surface-600 rounded text-sm resize-none focus:outline-none focus:border-accent"
                />
              </div>
            </div>
          )}

          {step === 2 && draft.type === "missing_person" && (
            <div className="space-y-4">
              <div className="flex items-start gap-2 p-3 rounded bg-blue-500/10 border border-blue-500/30 text-blue-200 text-xs">
                <Info size={14} className="shrink-0 mt-0.5" />
                <div>Subject details help teams identify the person. All fields optional — fill in what you know and refine later.</div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-fg-4 mb-1">Name</label>
                  <input
                    value={draft.subjectName}
                    onChange={(e) => set("subjectName", e.target.value)}
                    className="w-full px-3 py-2 bg-surface-700 border border-surface-600 rounded text-sm focus:outline-none focus:border-accent"
                  />
                </div>
                <div>
                  <label className="block text-xs text-fg-4 mb-1">Age</label>
                  <input
                    type="number"
                    value={draft.subjectAge}
                    onChange={(e) => set("subjectAge", e.target.value)}
                    className="w-full px-3 py-2 bg-surface-700 border border-surface-600 rounded text-sm focus:outline-none focus:border-accent"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs text-fg-4 mb-1">Description / clothing / behaviour</label>
                <textarea
                  value={draft.subjectDesc}
                  onChange={(e) => set("subjectDesc", e.target.value)}
                  rows={4}
                  placeholder="e.g. Male, 180cm, red jacket, navy jeans, walking stick. Known to head toward beach."
                  className="w-full px-3 py-2 bg-surface-700 border border-surface-600 rounded text-sm resize-none focus:outline-none focus:border-accent"
                />
              </div>
              <div>
                <label className="block text-xs text-fg-4 mb-1">Photo (shown on briefing + share link)</label>
                <input
                  ref={photoInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => pickPhoto(e.target.files?.[0] || null)}
                />
                <div className="flex items-start gap-3">
                  {draft.subjectPhotoPreview ? (
                    <img
                      src={draft.subjectPhotoPreview}
                      alt="Subject preview"
                      className="w-24 h-24 object-cover rounded border border-surface-600"
                    />
                  ) : (
                    <div className="w-24 h-24 rounded border border-dashed border-surface-600 flex items-center justify-center text-fg-4">
                      <Camera size={20} />
                    </div>
                  )}
                  <div className="flex flex-col gap-1.5">
                    <button
                      type="button"
                      onClick={() => photoInputRef.current?.click()}
                      className="px-3 py-1.5 text-xs bg-surface-700 hover:bg-surface-600 border border-surface-600 rounded"
                    >
                      {draft.subjectPhoto ? "Replace photo" : "Upload photo"}
                    </button>
                    {draft.subjectPhoto && (
                      <button
                        type="button"
                        onClick={() => pickPhoto(null)}
                        className="px-3 py-1.5 text-xs text-red-300 hover:text-red-200"
                      >
                        Remove
                      </button>
                    )}
                    {draft.subjectPhoto && (
                      <div className="text-[10px] text-fg-4">{draft.subjectPhoto.name} · {(draft.subjectPhoto.size / 1024).toFixed(0)}kB</div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {step === 2 && draft.type !== "missing_person" && (
            <div className="space-y-3">
              <div className="p-3 rounded bg-surface-700/50 border border-surface-600 text-xs text-fg-3">
                Subject information isn't required for {draft.type.replace(/_/g, " ")} operations. Proceed to the next step to set the datum.
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-5">
              <div className="flex items-start gap-2 p-3 rounded bg-blue-500/10 border border-blue-500/30 text-blue-200 text-xs">
                <Info size={14} className="shrink-0 mt-0.5" />
                <div>
                  <strong>Datums</strong> are reference points for search pattern generation. The primary
                  datum (LKP) is usually <em>"last seen at"</em>. Add secondary datums like <em>possible
                  locations (PLP)</em>, <em>sightings</em>, or <em>witness locations</em> to overlay multiple search
                  patterns. You can also add these later on the map.
                </div>
              </div>

              <div>
                <h3 className="text-xs text-fg-4 uppercase tracking-wider mb-2">Primary datum (LKP)</h3>
                <div className="mb-2">
                  <LocationLookup
                    onPick={(lat, lon) => {
                      set("primaryLat", lat.toFixed(6));
                      set("primaryLon", lon.toFixed(6));
                    }}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] text-fg-4 mb-1">Latitude</label>
                    <input
                      value={draft.primaryLat}
                      onChange={(e) => set("primaryLat", e.target.value)}
                      placeholder="55.4615"
                      className="w-full px-3 py-2 bg-surface-700 border border-surface-600 rounded text-sm focus:outline-none focus:border-accent"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-fg-4 mb-1">Longitude</label>
                    <input
                      value={draft.primaryLon}
                      onChange={(e) => set("primaryLon", e.target.value)}
                      placeholder="-4.6299"
                      className="w-full px-3 py-2 bg-surface-700 border border-surface-600 rounded text-sm focus:outline-none focus:border-accent"
                    />
                  </div>
                </div>
                <p className="text-[10px] text-fg-4 mt-1">
                  Leave blank to skip — you can drop a datum on the map after creating the operation.
                </p>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-xs text-fg-4 uppercase tracking-wider">Secondary datums</h3>
                  <button
                    onClick={addSecondary}
                    className="flex items-center gap-1 px-2 py-1 text-xs bg-accent/10 border border-accent/30 text-accent rounded hover:bg-accent/20"
                  >
                    <Plus size={12} /> Add
                  </button>
                </div>

                {draft.secondaryDatums.length === 0 && (
                  <p className="text-[11px] text-fg-4 italic">
                    Example: LKP at house + PLP at local park + Sighting from passer-by.
                  </p>
                )}

                <div className="space-y-2">
                  {draft.secondaryDatums.map((sd, i) => (
                    <div key={i} className="p-2 bg-surface-900 border border-surface-600 rounded space-y-2">
                      <div className="flex gap-2">
                        <select
                          value={sd.kind}
                          onChange={(e) => updateSecondary(i, { kind: e.target.value as DatumKind })}
                          className="px-2 py-1.5 bg-surface-700 border border-surface-600 rounded text-xs"
                        >
                          {KIND_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                          ))}
                        </select>
                        <input
                          value={sd.label}
                          onChange={(e) => updateSecondary(i, { label: e.target.value })}
                          placeholder="Label (e.g. Local park)"
                          className="flex-1 px-2 py-1.5 bg-surface-700 border border-surface-600 rounded text-xs"
                        />
                        <button
                          onClick={() => removeSecondary(i)}
                          className="text-fg-4 hover:text-red-400 px-1"
                          aria-label="Remove"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          value={sd.lat}
                          onChange={(e) => updateSecondary(i, { lat: e.target.value })}
                          placeholder="Lat"
                          className="px-2 py-1.5 bg-surface-700 border border-surface-600 rounded text-xs"
                        />
                        <input
                          value={sd.lon}
                          onChange={(e) => updateSecondary(i, { lon: e.target.value })}
                          placeholder="Lon"
                          className="px-2 py-1.5 bg-surface-700 border border-surface-600 rounded text-xs"
                        />
                      </div>
                      <input
                        value={sd.notes}
                        onChange={(e) => updateSecondary(i, { notes: e.target.value })}
                        placeholder="Notes (optional)"
                        className="w-full px-2 py-1.5 bg-surface-700 border border-surface-600 rounded text-xs"
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-4">
              <h3 className="text-sm font-semibold">Review</h3>
              <ReviewRow label="Type" value={TYPES.find((t) => t.value === draft.type)?.label || draft.type} />
              <ReviewRow label="Name" value={draft.name} />
              {draft.type === "missing_person" && (
                <>
                  {draft.subjectName && <ReviewRow label="Subject" value={`${draft.subjectName}${draft.subjectAge ? `, ${draft.subjectAge}` : ""}`} />}
                  {draft.subjectDesc && <ReviewRow label="Description" value={draft.subjectDesc} />}
                </>
              )}
              {draft.weatherNotes && <ReviewRow label="Conditions" value={draft.weatherNotes} />}
              {draft.primaryLat && draft.primaryLon && (
                <ReviewRow label="LKP" value={`${parseFloat(draft.primaryLat).toFixed(5)}, ${parseFloat(draft.primaryLon).toFixed(5)}`} />
              )}
              {draft.secondaryDatums.length > 0 && (
                <div>
                  <div className="text-xs text-fg-4 uppercase tracking-wider mb-1">Secondary datums</div>
                  <ul className="space-y-1">
                    {draft.secondaryDatums.map((sd, i) => (
                      <li key={i} className="text-xs text-fg-2">
                        <span className="font-mono text-[10px] text-fg-4">{sd.kind.toUpperCase()}</span>{" "}
                        {sd.label || "(unnamed)"}{" "}
                        <span className="text-fg-4">— {sd.lat || "?"}, {sd.lon || "?"}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {error && (
                <div className="p-2 rounded bg-red-500/10 border border-red-500/30 text-red-300 text-xs">
                  {error}
                </div>
              )}
              <p className="text-[11px] text-fg-4 italic">
                After creation you can add more datums, generate search grids, add teams, and log reports from the operation page.
              </p>
            </div>
          )}
        </div>

        {/* Footer buttons */}
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-t border-surface-700 bg-surface-900">
          <button
            onClick={() => (step > 1 ? setStep(step - 1) : onClose())}
            className="flex items-center gap-1 px-3 py-2 text-sm text-fg-3 hover:text-fg-1"
          >
            {step > 1 ? <><ChevronLeft size={14} /> Back</> : "Cancel"}
          </button>
          {step < totalSteps ? (
            <button
              onClick={() => setStep(step + 1)}
              disabled={!canAdvance}
              className="flex items-center gap-1 px-4 py-2 text-sm bg-accent text-black rounded font-medium disabled:opacity-50"
            >
              Next <ChevronRight size={14} />
            </button>
          ) : (
            <button
              onClick={submit}
              disabled={creating}
              className="flex items-center gap-1 px-4 py-2 text-sm bg-accent text-black rounded font-medium disabled:opacity-50"
            >
              <Check size={14} /> {creating ? "Creating..." : "Create operation"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3 text-sm">
      <div className="w-24 text-xs text-fg-4 uppercase tracking-wider pt-0.5">{label}</div>
      <div className="flex-1 text-fg-1">{value}</div>
    </div>
  );
}
