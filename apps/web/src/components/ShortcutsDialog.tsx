import { SHORTCUTS } from '../lib/shortcuts';
import { Dialog } from './Dialog';
import { Kbd } from './Kbd';

export function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onClose={onClose} label="Keyboard shortcuts" className="shortcuts">
      <table>
        <tbody>
          {SHORTCUTS.map((row) => (
            <tr key={row.description}>
              <td>
                {row.keys.map((combo, index) => (
                  <span key={index} className="inline-gap" style={{ display: 'inline-flex', marginRight: 8 }}>
                    {combo.map((key) => (
                      <Kbd key={key}>{key}</Kbd>
                    ))}
                  </span>
                ))}
              </td>
              <td>{row.description}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="small muted" style={{ marginBottom: 0 }}>
        Shortcuts are ignored while you type in a field.
      </p>
    </Dialog>
  );
}
