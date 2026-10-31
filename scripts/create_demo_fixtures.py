"""Create synthetic presentation fixtures in .cache/demo; no private data required."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / '.cache/demo'


def pdf(pages):
    objects = [b'<< /Type /Catalog /Pages 2 0 R >>', b'']
    children = []
    for _ in range(pages):
        identifier = len(objects) + 1
        children.append(f'{identifier} 0 R')
        objects.append(b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << >> >>')
    objects[1] = f'<< /Type /Pages /Count {pages} /Kids [{" ".join(children)}] >>'.encode()
    data = bytearray(b'%PDF-1.4\n')
    offsets = [0]
    for number, obj in enumerate(objects, 1):
        offsets.append(len(data))
        data.extend(f'{number} 0 obj\n'.encode() + obj + b'\nendobj\n')
    xref = len(data)
    data.extend(f'xref\n0 {len(offsets)}\n0000000000 65535 f \n'.encode())
    for offset in offsets[1:]:
        data.extend(f'{offset:010d} 00000 n \n'.encode())
    data.extend(f'trailer\n<< /Size {len(offsets)} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n'.encode())
    return data


def main():
    DEST.mkdir(parents=True, exist_ok=True)
    good = r'''\documentclass{article}
\title{LaTeXLLM Demonstration}
\author{Demo Student}
\begin{document}
\maketitle
\section{Introduction}
The results is preliminary. This study examine local academic editing.
We ran three experiments and we think the method is really good.
The proposed method achieved an accuracy of $95\%$.
\section{Notes}
Dataset: 200 samples. Baseline accuracy: 89 percent.
Proposed method: 95 percent. Limitation: one small dataset.
\end{document}
'''
    (DEST / 'valid.tex').write_text(good, encoding='utf-8')
    (DEST / 'error.tex').write_text(good.replace('\\section{Introduction}', '\\unknowncommand{Introduction}'), encoding='utf-8')
    (DEST / 'cancel.tex').write_text('\\documentclass{article}\n\\begin{document}\n\\loop\\iftrue\\repeat\n\\end{document}\n', encoding='utf-8')
    for count in (1000, 1001):
        text = ' '.join(['word'] * count)
        assert len(text.split()) == count
        (DEST / f'{count}-words.txt').write_text(text, encoding='utf-8')
    for count in (1, 100, 101):
        (DEST / f'{count}-pages.pdf').write_bytes(pdf(count))
    (DEST / 'invalid.pdf').write_text('This is not a PDF.', encoding='utf-8')
    with (DEST / 'over-20mb.pdf').open('wb') as stream:
        stream.write(pdf(1))
        stream.truncate(20 * 1024 * 1024 + 1)
    print(f'Demo fixtures ready: {DEST}')
    print('Blank PDFs test validation/consent only; use a real permitted paper for summary quality.')
    print('cancel.tex deliberately loops: use only the Docker sandbox; cancel promptly.')


if __name__ == '__main__':
    main()
