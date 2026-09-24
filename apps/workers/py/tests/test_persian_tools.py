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

    def test_yah_kaf_normalization(self):
        # ي -> ی, ك -> ک
        self.assertEqual(t.normalize_persian("علي كريم"), "علی کریم")
        self.assertEqual(t.normalize_persian("يكي كتاب"), "یکی کتاب")

    def test_diacritics_removal(self):
        # Arabic diacritics should be removed
        text_with_diacritics = "مُحَمَّد"
        cleaned = t.remove_diacritics(text_with_diacritics)
        # Should not contain harakat
        self.assertNotIn("ُ", cleaned)
        self.assertNotIn("َ", cleaned)

    def test_persian_digits_to_english(self):
        self.assertEqual(t.persian_digits_to_english("۱۲۳۴۵"), "12345")
        self.assertEqual(t.persian_digits_to_english("ماده ۱۰"), "ماده 10")
        self.assertEqual(t.persian_digits_to_english("١٢٣"), "123")  # Arabic digits too

    def test_english_digits_to_persian(self):
        self.assertEqual(t.english_digits_to_persian("12345"), "۱۲۳۴۵")

    def test_normalize_with_english_digits_option(self):
        out = t.normalize_persian("ماده ۱۰", to_english_digits=True)
        self.assertEqual(out, "ماده 10")


class TestTokenization(unittest.TestCase):
    def test_tokenize_simple(self):
        tokens = t.tokenize_persian("سلام دنیا")
        self.assertIn("سلام", tokens)
        self.assertIn("دنیا", tokens)

    def test_tokenize_with_punctuation(self):
        tokens = t.tokenize_persian("سلام، دنیا!")
        self.assertIn("سلام", tokens)
        self.assertIn("دنیا", tokens)

    def test_tokenize_accuracy(self):
        text = "این یک قرارداد حقوقی است"
        tokens = t.tokenize_persian(text)
        # Should tokenize into at least 4 tokens
        self.assertGreaterEqual(len(tokens), 4)
        self.assertIn("قرارداد", tokens)

    def test_remove_stopwords(self):
        tokens = t.tokenize_persian("این یک قرارداد است", remove_stopwords=False)
        tokens_filtered = t.tokenize_persian("این یک قرارداد است", remove_stopwords=True)
        # Filtered should be shorter
        self.assertLess(len(tokens_filtered), len(tokens))
        self.assertIn("قرارداد", tokens_filtered)

    def test_stopwords_list_complete(self):
        stopwords = t.get_stopwords()
        # Should contain common Persian stopwords
        self.assertIn("و", stopwords)
        self.assertIn("در", stopwords)
        self.assertIn("به", stopwords)
        self.assertIn("از", stopwords)
        self.assertGreater(len(stopwords), 50)

    def test_stemming(self):
        # Test stemming removes plural suffixes
        self.assertEqual(t.stem_persian("کتاب‌ها"), "کتاب")
        self.assertEqual(t.stem_persian("قراردادها"), "قرارداد")
        # Verb stemming
        stemmed = t.stem_persian("می‌کنند")
        self.assertTrue(len(stemmed) > 0)

    def test_lemmatization(self):
        lemma = t.lemmatize_persian("رفت")
        self.assertEqual(lemma, "رفتن")
        lemma2 = t.lemmatize_persian("کرد")
        self.assertEqual(lemma2, "کردن")


class TestNER(unittest.TestCase):
    def test_extract_cities(self):
        text = "پرونده در دادگاه تهران و اصفهان بررسی شد"
        cities = t.extract_cities(text)
        self.assertIn("تهران", cities)
        self.assertIn("اصفهان", cities)

    def test_extract_courts(self):
        text = "پرونده به دیوان عالی کشور و دادگاه انقلاب ارجاع شد"
        courts = t.extract_courts(text)
        self.assertGreater(len(courts), 0)
        court_texts = [c["text"] for c in courts]
        # At least one should contain دیوان or دادگاه
        self.assertTrue(any("دیوان" in ct or "دادگاه" in ct for ct in court_texts))

    def test_extract_persons(self):
        text = "آقای محمد حسینی و خانم فاطمه احمدی"
        persons = t.extract_persons(text)
        # Should find at least one person
        self.assertGreaterEqual(len(persons), 1)

    def test_ner_full(self):
        text = "آقای علی محمدی در تهران، پرونده را به دیوان عالی کشور در تاریخ ۱۴۰۲/۰۵/۱۲ برد"
        result = t.ner_persian(text)
        self.assertIn("cities", result)
        self.assertIn("courts", result)
        self.assertIn("persons", result)
        self.assertIn("dates", result)
        self.assertGreater(len(result["cities"]), 0)
        self.assertGreater(len(result["courts"]), 0)

    def test_ner_precision_cities(self):
        # Precision test: should not false-positive non-cities
        text = "این متن هیچ شهری ندارد"
        cities = t.extract_cities(text)
        self.assertEqual(len(cities), 0)

    def test_ner_legal_refs(self):
        text = "مطابق ماده ۱۰ قانون مدنی و تبصره ۲ قانون تجارت"
        result = t.ner_persian(text)
        self.assertGreater(len(result["legal_refs"]), 0)


class TestChunking(unittest.TestCase):
    def test_short_text_single_chunk(self):
        self.assertEqual(len(t.chunk_legal_text("سلام دنیا.")), 1)

    def test_long_text_multiple_chunks_overlap(self):
        sents = [f"جملهٔ بلند شمارهٔ {i} برای تست است." for i in range(60)]
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

    def test_is_persian_text(self):
        self.assertTrue(t.is_persian_text("سلام دنیا"))
        self.assertFalse(t.is_persian_text("Hello world"))
        self.assertTrue(t.is_persian_text("سلام Hello", threshold=0.3))


if __name__ == "__main__":
    unittest.main()
