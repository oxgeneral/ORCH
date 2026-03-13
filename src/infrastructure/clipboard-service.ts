/**
 * Clipboard service for detecting and extracting images from the system clipboard.
 *
 * Platform support:
 * - macOS: osascript (clipboard info / clipboard as PNGf)
 * - Linux: xclip -selection clipboard
 * - Windows: PowerShell Get-Clipboard
 */

import { execFile as execFileCb, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile, readFile, unlink, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OrchestryError } from '../domain/errors.js';

const execFile = promisify(execFileCb);

const EXEC_TIMEOUT_MS = 3_000;

export type ClipboardContentType = 'image' | 'text' | 'empty';

export interface ClipboardImage {
  data: Buffer;
  ext: string;
}

/**
 * Checks whether the required clipboard tool is available on this platform.
 *
 * - macOS: pbpaste (always present)
 * - Linux: xclip
 * - Windows: PowerShell (always present)
 */
export function isClipboardToolAvailable(): boolean {
  const platform = process.platform;

  if (platform === 'darwin') {
    // pbpaste/osascript are always available on macOS
    return true;
  }

  if (platform === 'linux') {
    try {
      execFileSync('which', ['xclip'], { timeout: EXEC_TIMEOUT_MS, stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }

  if (platform === 'win32') {
    // PowerShell is always available on modern Windows
    return true;
  }

  return false;
}

/**
 * Detects the type of content currently in the system clipboard.
 *
 * Returns 'image' if the clipboard contains an image (PNG or TIFF),
 * 'text' if it contains text, or 'empty' if the clipboard is empty.
 */
export async function detectClipboardType(): Promise<ClipboardContentType> {
  const platform = process.platform;

  if (platform === 'darwin') {
    return detectMacOS();
  }

  if (platform === 'linux') {
    return detectLinux();
  }

  if (platform === 'win32') {
    return detectWindows();
  }

  throw new OrchestryError(
    `Unsupported platform for clipboard: ${platform}`,
    1,
    'Supported: macOS, Linux, Windows',
  );
}

/**
 * Extracts an image from the system clipboard.
 *
 * Returns the image data as a Buffer with its file extension,
 * or null if the clipboard does not contain an image.
 */
export async function getClipboardImage(): Promise<ClipboardImage | null> {
  const type = await detectClipboardType();
  if (type !== 'image') return null;

  const platform = process.platform;

  if (platform === 'darwin') {
    return getImageMacOS();
  }

  if (platform === 'linux') {
    return getImageLinux();
  }

  if (platform === 'win32') {
    return getImageWindows();
  }

  return null;
}

// ─── macOS ────────────────────────────────────────────────────────────────────

async function detectMacOS(): Promise<ClipboardContentType> {
  try {
    const { stdout } = await execFile('osascript', ['-e', 'clipboard info'], {
      timeout: EXEC_TIMEOUT_MS,
    });

    if (stdout.includes('«class PNGf»') || stdout.includes('«class TIFF»')) {
      return 'image';
    }

    if (stdout.includes('«class ut16»') || stdout.includes('«class utf8»')) {
      return 'text';
    }

    // If clipboard info returned something but not text or image
    return stdout.trim().length > 0 ? 'text' : 'empty';
  } catch {
    return 'empty';
  }
}

async function getImageMacOS(): Promise<ClipboardImage | null> {
  const dir = await mkdtemp(join(tmpdir(), 'orch-clip-'));
  const filePath = join(dir, 'clipboard.png');

  try {
    // AppleScript to write clipboard image (as PNG) to a temp file
    const script = `
      set theFile to POSIX file "${filePath}"
      try
        set imgData to the clipboard as «class PNGf»
        set fRef to open for access theFile with write permission
        write imgData to fRef
        close access fRef
        return "ok"
      on error
        try
          close access theFile
        end try
        return "error"
      end try
    `;

    const { stdout } = await execFile('osascript', ['-e', script], {
      timeout: EXEC_TIMEOUT_MS,
    });

    if (stdout.trim() !== 'ok') return null;

    const data = await readFile(filePath);
    return { data, ext: 'png' };
  } catch {
    return null;
  } finally {
    // Cleanup temp file
    try {
      await unlink(filePath);
    } catch {
      // Ignore cleanup errors
    }
    try {
      await rm(dir, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
  }
}

// ─── Linux ────────────────────────────────────────────────────────────────────

async function detectLinux(): Promise<ClipboardContentType> {
  try {
    const { stdout } = await execFile(
      'xclip',
      ['-selection', 'clipboard', '-t', 'TARGETS', '-o'],
      { timeout: EXEC_TIMEOUT_MS },
    );

    const targets = stdout.toLowerCase();

    if (targets.includes('image/png') || targets.includes('image/tiff') || targets.includes('image/jpeg')) {
      return 'image';
    }

    if (targets.includes('text/plain') || targets.includes('utf8_string') || targets.includes('string')) {
      return 'text';
    }

    return targets.trim().length > 0 ? 'text' : 'empty';
  } catch {
    return 'empty';
  }
}

async function getImageLinux(): Promise<ClipboardImage | null> {
  try {
    const { stdout } = await execFile(
      'xclip',
      ['-selection', 'clipboard', '-t', 'image/png', '-o'],
      { timeout: EXEC_TIMEOUT_MS, encoding: 'buffer' as unknown as BufferEncoding, maxBuffer: 50 * 1024 * 1024 },
    );

    // stdout is a Buffer when encoding is 'buffer'
    const data = Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout, 'binary');
    if (data.length === 0) return null;

    return { data, ext: 'png' };
  } catch {
    return null;
  }
}

// ─── Windows ──────────────────────────────────────────────────────────────────

async function detectWindows(): Promise<ClipboardContentType> {
  try {
    // Check for image first
    const { stdout: imgCheck } = await execFile(
      'powershell',
      ['-NoProfile', '-Command', 'if (Get-Clipboard -Format Image) { "image" } else { "none" }'],
      { timeout: EXEC_TIMEOUT_MS },
    );

    if (imgCheck.trim() === 'image') return 'image';

    // Check for text
    const { stdout: textCheck } = await execFile(
      'powershell',
      ['-NoProfile', '-Command', 'if (Get-Clipboard) { "text" } else { "empty" }'],
      { timeout: EXEC_TIMEOUT_MS },
    );

    return textCheck.trim() === 'text' ? 'text' : 'empty';
  } catch {
    return 'empty';
  }
}

async function getImageWindows(): Promise<ClipboardImage | null> {
  const dir = await mkdtemp(join(tmpdir(), 'orch-clip-'));
  const filePath = join(dir, 'clipboard.png');

  try {
    const script = `
      Add-Type -AssemblyName System.Windows.Forms
      $img = [System.Windows.Forms.Clipboard]::GetImage()
      if ($img) {
        $img.Save('${filePath.replace(/\\/g, '\\\\')}', [System.Drawing.Imaging.ImageFormat]::Png)
        Write-Output 'ok'
      } else {
        Write-Output 'error'
      }
    `;

    const { stdout } = await execFile('powershell', ['-NoProfile', '-Command', script], {
      timeout: EXEC_TIMEOUT_MS,
    });

    if (stdout.trim() !== 'ok') return null;

    const data = await readFile(filePath);
    return { data, ext: 'png' };
  } catch {
    return null;
  } finally {
    try {
      await unlink(filePath);
    } catch {
      // Ignore cleanup errors
    }
    try {
      await rm(dir, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
  }
}
