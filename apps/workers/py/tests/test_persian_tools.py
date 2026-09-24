import unittest

from pylegal import persian_tools as t


class TestNormalizePersian(unittest.TestCase):
    def test_arabic_to_persian_folding(self):
        self.assertEqual(t.normalize_persian("شرايط الكي"), "شرایط الکی")

    def test_digits_folded(self):
        self.assertEqual(t.normalize_persian("ماده ١٠"), "ماده ۱۰")

    def test_whitespace_collapsed_newlines_preserved(self):
        out = t.normalize_persian("خط   اول\r\nخط\tدوم")
        self.assertEqual(out, "خط اول\nخط دوم")

    def test_non_str_rejected(self):
        with self.assertRaises(TypeError):
            t.normalize_persian(123)  # type: ignore


class TestChunking(unittest.TestCase):
    def test_short_text_single_chunk(self):
        self.assertEqual(len(t.chunk_legal_text("سلام دنیا.")), 1)

    def test_long_text_multiple_chunks_overlap(self):
        sents = ["جملهٔ بلند شمارهٔ %d برای تست است." % i for i in range(60)]
        text = ". ".join(sents)
        chunks = t.chunk_legal_text(text, max_chars=200, overlap=50)
        self.assertGreater(len(chunks), 2)
        for c in chunks:
            self.assertLessEqual(len(c), 260)  # room for overlap carry-over

    def test_bad_params_rejected(self):
        with self.assertRaises(ValueError):
            t.chunk_legal_text("x", max_chars=100, overlap=200)

    def test_deterministic(self):
        text = "الف ب ت. ج د هـ. و ز ح." * 10
        self.assertEqual(t.chunk_legal_text(text), t.chunk_legal_text(text))


class TestArticleRefs(unittest.TestCase):
    def test_extracts_persian_article_ref(self):
        refs = t.article_refs("مطابق ماده ۱۰ قانون مدنی و تبصره ۲")
        self.assertIn({"kind": "ماده", "number": "۱۰", "law": "قانون مدنی"}, refs)
        self.assertIn({"kind": "تبصره", "number": "۲", "law": ""}, refs)

    def test_no_refs(self):
        self.assertEqual(t.article_refs("متن بدون ارجاع"), [])


if __name__ == "__main__":
    unittest.main()
