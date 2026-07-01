import { Box, createTheme, Stack, ThemeProvider, Typography } from '@mui/material';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import type { ReactElement } from 'react';
import type { ShiftEvent } from '../types';

// Mirror of roger-platform: a single application theme built once, then RE-INJECTED per bar via ThemeProvider
// (Bryntum renders bars in detached DOM, outside the React tree, so MUI context doesn't reach them otherwise).
const applicationTheme = createTheme({
    palette: { primary: { main: '#2962ff' }, warning: { main: '#ed6c02' } },
    typography: { fontFamily: 'Inter, Roboto, sans-serif' },
});

const fmtTime = (iso: string): string => {
    const d = new Date(iso);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

// Cheap deterministic "severity" so some bars carry the heavier icon + border branch (like real shifts with insights).
const severityOf = (id: string): 'none' | 'warning' => {
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
    return Math.abs(h) % 4 === 0 ? 'warning' : 'none';
};

/**
 * Rich event bar mirroring ShiftSchedulerEventContent: emotion-styled MUI Stack/Typography/Box + an icon, two text
 * lines (label + time range). Each instance is an emotion render — the cost the trivial <span> repro skipped.
 */
function EventBar({ event }: { event: ShiftEvent }): ReactElement {
    const severity = severityOf(event.id);
    const label = `${event.name} • Area ${event.resourceId % 7}`;
    const timeLine = `${fmtTime(event.startDate)}-${fmtTime(event.endDate)}`;
    return (
        <Stack
            direction="row"
            sx={{
                alignItems: 'center',
                gap: 0.5,
                width: '100%',
                minWidth: 0,
                color: 'common.white',
                borderLeft: severity === 'warning' ? '3px solid' : 'none',
                borderColor: 'warning.main',
                pl: severity === 'warning' ? 0.5 : 0,
            }}
        >
            <Stack sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="caption" color="inherit" noWrap sx={{ fontWeight: 700 }}>
                    {label}
                </Typography>
                <Typography variant="caption" color="inherit" noWrap>
                    {timeLine}
                </Typography>
            </Stack>
            <Box sx={{ display: 'flex', alignItems: 'center' }}>
                {severity === 'warning' ? (
                    <WarningAmberIcon sx={{ fontSize: 14 }} />
                ) : (
                    <AccessTimeIcon sx={{ fontSize: 14 }} />
                )}
            </Box>
        </Stack>
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
