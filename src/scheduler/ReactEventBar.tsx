import type { ReactElement } from 'react';
import type { ShiftEvent } from '../types';

// Plain-React (NO MUI) twin of ThemedEventBar. Same nested tree depth and conditional branches as
// roger-platform's ShiftSchedulerEventContent (see screenshot): a relative container, an absolutely
// positioned icon gutter reserved when there's a note/severity, a text column with a bold label line
// + start/end time lines, and a narrow-view layout branch. The point of the react↔mui A/B: hold the
// STRUCTURE constant so the delta measures MUI/emotion overhead, not tree complexity. The old trivial
// 2-div bar under-reported React cost precisely because it skipped all of this.

const fmtTime = (iso: string): string => {
    const d = new Date(iso);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

// One deterministic hash per event → the same branch flags every render (stable, like real shift data).
const hashOf = (id: string): number => {
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
    return Math.abs(h);
};

export interface BarMeta {
    severity: 'none' | 'warning';
    hasNote: boolean;
    narrow: boolean;
    reserveIconGutter: boolean;
    label: string;
    startTime: string;
    endTime: string;
}

// SINGLE source of truth for a bar's content + branch flags. Shared by the react AND dom renderers so the two
// paths carry identical content — the A/B/C delta then measures the rendering engine, not the data.
export function deriveBarMeta(event: ShiftEvent): BarMeta {
    const h = hashOf(event.id);
    const severity: 'none' | 'warning' = h % 4 === 0 ? 'warning' : 'none';
    const hasNote = h % 3 === 0;
    return {
        severity,
        hasNote,
        narrow: h % 5 === 0, // some bars take the compact layout branch, like isNarrowView
        reserveIconGutter: hasNote || severity === 'warning',
        label: `${event.name} • Area ${event.resourceId % 7}`,
        startTime: fmtTime(event.startDate),
        endTime: fmtTime(event.endDate),
    };
}

// Tiny inline SVGs stand in for roger's icon components — real DOM + reconcile cost, no MUI icon import.
function ClockIcon(): ReactElement {
    return (
        <svg className="rb-icon" viewBox="0 0 24 24" width="12" height="12" aria-hidden="true">
            <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" />
            <path d="M12 7v5l3 2" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
    );
}

function WarningIcon(): ReactElement {
    return (
        <svg className="rb-icon" viewBox="0 0 24 24" width="12" height="12" aria-hidden="true">
            <path d="M12 3 2 20h20L12 3z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
            <path d="M12 10v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <circle cx="12" cy="17" r="1" fill="currentColor" />
        </svg>
    );
}

function NoteIcon(): ReactElement {
    return (
        <svg className="rb-icon" viewBox="0 0 24 24" width="12" height="12" aria-hidden="true">
            <path d="M6 3h9l3 3v15H6z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
            <path d="M9 9h6M9 13h6M9 17h3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
    );
}

// The icon cluster (roger's ShiftSchedulerEventContentIcons): a warning OR clock, plus a note glyph.
function EventIcons({ severity, hasNote }: { severity: 'none' | 'warning'; hasNote: boolean }): ReactElement {
    return (
        <span className="rb-icons">
            {severity === 'warning' ? <WarningIcon /> : <ClockIcon />}
            {hasNote ? <NoteIcon /> : null}
        </span>
    );
}

export function ReactEventBar({ event }: { event: ShiftEvent }): ReactElement {
    const { severity, hasNote, narrow, reserveIconGutter, label, startTime, endTime } = deriveBarMeta(event);

    if (narrow) {
        return (
            <div className="rb rb--narrow" data-severity={severity}>
                <div className="rb-narrow-label">{label}</div>
                <EventIcons severity={severity} hasNote={hasNote} />
            </div>
        );
    }

    return (
        <div className="rb" data-severity={severity}>
            {reserveIconGutter ? (
                <div className="rb-gutter">
                    <EventIcons severity={severity} hasNote={hasNote} />
                </div>
            ) : null}
            <div className="rb-col">
                <div className="rb-label" style={reserveIconGutter ? { paddingRight: 16 } : undefined}>
                    {label}
                </div>
                <div className="rb-time">{startTime}</div>
                <div className="rb-time">{endTime}</div>
            </div>
        </div>
    );
}
