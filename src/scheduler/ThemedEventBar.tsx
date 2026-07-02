import { Box, createTheme, Stack, ThemeProvider, Typography } from '@mui/material';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import CommentIcon from '@mui/icons-material/Comment';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import { createContext, useContext, type ReactElement } from 'react';
import type { ShiftEvent } from '../types';

// Mirror of roger-platform: a single application theme built once, then RE-INJECTED per bar via ThemeProvider
// (Bryntum renders bars in detached DOM, outside the React tree, so MUI context doesn't reach them otherwise).
const applicationTheme = createTheme({
    palette: { primary: { main: '#2962ff' }, warning: { main: '#ed6c02' } },
    typography: { fontFamily: 'Inter, Roboto, sans-serif' },
});

// Mirror of useTranslation(): react-i18next reads the i18n context on EVERY render. Bars render in detached DOM,
// so — exactly like the theme — the context read happens per bar, per paint. A no-provider default keeps the cost
// (a useContext subscription) without pulling in react-i18next. This is the per-bar hook cost the real bar pays.
const I18nContext = createContext<(key: string) => string>((key) => key.split('.').pop() ?? key);
const useT = () => useContext(I18nContext);

const fmtTime = (iso: string): string => {
    const d = new Date(iso);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

// Cheap deterministic per-event flags so bars carry the same branchy content mix as real shifts (note / recurring /
// insight severity), matching ShiftSchedulerEventContentIcons' priority logic.
const hashOf = (id: string): number => {
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
    return Math.abs(h);
};

interface ShiftMeta {
    label: string;
    startTime: string;
    endTime: string;
    hasNote: boolean;
    severity: 'none' | 'warning';
}

const deriveShiftMeta = (event: ShiftEvent, t: (key: string) => string): ShiftMeta => {
    const h = hashOf(event.id);
    const areaName = h % 5 === 0 ? t('planning.no_area') : `Area ${event.resourceId % 7}`;
    const locationName = `Loc ${event.resourceId % 3}`;
    return {
        label: [areaName, locationName].filter(Boolean).join(' • '),
        startTime: fmtTime(event.startDate),
        endTime: fmtTime(event.endDate),
        hasNote: h % 3 === 0,
        severity: h % 4 === 0 ? 'warning' : 'none',
    };
};

// Mirror of ShiftSchedulerEventContentIcons (narrow): a comment icon when the shift has a note, an insight icon for
// severity. Each icon is an SVG component render (roger uses Hugeicons; MUI icons are the same shape/cost here).
function EventIcons({ hasNote, severity }: { hasNote: boolean; severity: 'none' | 'warning' }): ReactElement {
    return (
        <>
            {hasNote && <CommentIcon sx={{ fontSize: 14 }} />}
            {severity === 'warning' ? <WarningAmberIcon sx={{ fontSize: 14 }} /> : <AccessTimeIcon sx={{ fontSize: 14 }} />}
        </>
    );
}

/**
 * Rich event bar mirroring roger-platform's ShiftSchedulerEventContent (NARROW branch — the repro runs the month
 * `weekAndDayLetter` preset, which maps to isNarrowView). Same tree the real bar pays on every paint: a relative Box,
 * an absolutely-positioned icon cluster, a Stack with THREE Typography lines (label / start / end), plus a per-bar
 * useTranslation() context read. Every `sx` prop is one emotion serialization — this is the render cost the trivial
 * <span> repro skipped and the cheaper 2-line bar under-counted.
 */
function EventBar({ event }: { event: ShiftEvent }): ReactElement {
    const t = useT();
    const { label, startTime, endTime, hasNote, severity } = deriveShiftMeta(event, t);
    const reserveGutter = hasNote || severity === 'warning';
    return (
        <Box sx={{ position: 'relative', width: '100%', minWidth: 0, color: 'common.white' }}>
            <Box sx={{ position: 'absolute', top: 0, right: 0, display: 'flex', alignItems: 'center', gap: 0.25 }}>
                <EventIcons hasNote={hasNote} severity={severity} />
            </Box>
            <Stack sx={{ minWidth: 0 }}>
                <Typography variant="caption" color="inherit" noWrap sx={{ fontWeight: 700, pr: reserveGutter ? '16px' : 0 }}>
                    {label}
                </Typography>
                <Typography variant="caption" color="inherit" noWrap>
                    {startTime}
                </Typography>
                <Typography variant="caption" color="inherit" noWrap>
                    {endTime}
                </Typography>
            </Stack>
        </Box>
    );
}

// A/B/C switch: localStorage.perfNoThemeProvider='1' drops the PER-BAR ThemeProvider (relies on a global one only).
// Tests whether the per-bar provider — not the emotion components — is the cost. NOTE: with Bryntum's detached DOM
// the bars then fall back to MUI's default theme (styling changes), since the global provider's context can't reach them.
const noPerBarProvider = (): boolean => {
    try {
        return localStorage.getItem('perfNoThemeProvider') === '1';
    } catch {
        return false;
    }
};

/** Per-bar themed renderer — faithful to createThemedRenderer: a fresh ThemeProvider wraps every bar on every paint. */
export function renderThemedEventBar({ event }: { event: ShiftEvent }): ReactElement {
    if (noPerBarProvider()) {
        return <EventBar event={event} />;
    }
    return (
        <ThemeProvider theme={applicationTheme}>
            <EventBar event={event} />
        </ThemeProvider>
    );
}

export { applicationTheme };
