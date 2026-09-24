import base64
import io
import unittest
import zipfile
import zlib

from pylegal import file_extract as fx
from pylegal.worker import handle


def make_minimal_docx(text: str) -> bytes:
    xml = f"""<?xml version="1.0"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>{text}</w:t></w:r></w:p>
    <w:p><w:r><w:t>خط دوم سند</w:t></w:r></w:p>
  </w:body>
</w:document>""".encode("utf-8")
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("word/document.xml", xml)
    return buf.getvalue()


def make_minimal_pdf(stream_text: bytes) -> bytes:
    content = zlib.compress(b"BT (" + stream_text + b") Tj ET")
    header = b"%PDF-1.4\n1 0 obj<</Length " + str(len(content)).encode() + b">>stream\n"
    return header + content + b"\nendstream\nendobj\ntrailer<</Root 1 0 R>>"


class TestFileDigest(unittest.TestCase):
    def test_digest_text(self):
        d = fx.file_digest("سلام".encode("utf-8"), "note.txt")
        self.assertEqual(d["kindGuess"], "text")
        self.assertEqual(d["bytes"], len("سلام".encode("utf-8")))
        self.assertEqual(len(d["sha256"]), 64)

    def test_digest_pdf_by_magic(self):
        d = fx.file_digest(b"%PDF-1.4 junk", "scan.pdf")
        self.assertEqual(d["kindGuess"], "pdf")

    def test_deterministic_hash(self):
        self.assertEqual(fx.sha256_hex(b"abc"), fx.sha256_hex(b"abc"))


class TestExtract(unittest.TestCase):
    def test_txt_utf8(self):
        out = fx.extract_any("ماده ۱۰ قانون مدنی".encode(), "q.txt")
        self.assertEqual(out["format"], "text")
        self.assertIn("قانون مدنی", out["text"])

    def test_docx_real_zip(self):
        data = make_minimal_docx("این سند فروش است")
        out = fx.extract_any(data, "sale.docx")
        self.assertEqual(out["format"], "docx")
        self.assertIn("سند فروش", out["text"])
        self.assertIn("خط دوم سند", out["text"])

    def test_docx_corrupt_rejected(self):
        with self.assertRaises(ValueError):
            fx.extract_docx(b"PK\x03\x04corrupted")

    def test_pdf_with_text_stream(self):
        out = fx.extract_pdf(make_minimal_pdf(b"Hello Contract"))
        self.assertIn("Hello Contract", out["text"])

    def test_pdf_scanned_marks_needs_ocr_no_hallucination(self):
        out = fx.extract_pdf(b"%PDF-1.4\n1 0 obj<</Subtype/Image>>endobj\n%%EOF")
        self.assertTrue(out.get("needs_ocr"))
        self.assertEqual(out["text"], "")

    def test_not_pdf_header(self):
        with self.assertRaises(ValueError):
            fx.extract_pdf(b"NOTAPDF")

    def test_worker_tool_roundtrip_base64(self):
        raw = "تعهد به پرداخت".encode("utf-8")
        r = handle({"jobId": "fx1", "tool": "extract_any",
                    "input": {"data_b64": base64.b64encode(raw).decode(), "filename": "تعهد.txt"}})
        self.assertTrue(r["ok"])
        self.assertIn("تعهد", r["output"]["text"])

    def test_worker_file_digest_tool(self):
        raw = b"%PDF-1.4 body"
        r = handle({"tool": "file_digest",
                    "input": {"data_b64": base64.b64encode(raw).decode(), "filename": "a.pdf"}})
        self.assertEqual(r["output"]["kindGuess"], "pdf")

    def test_unknown_binary_honest_flag(self):
        out = fx.extract_any(b"\x00\x01\x02\x03\xff\xfe", "mystery.bin")
        self.assertTrue(out.get("chars") is not None)


if __name__ == "__main__":
    unittest.main()
