import unittest
from unittest.mock import patch

from xhs_parser import parser


class FakeResponse:
    def __init__(self, text="", url="https://www.xiaohongshu.com/discovery/item/note123"):
        self.text = text
        self.url = url

    def raise_for_status(self):
        return None


class FakeAsyncClient:
    def __init__(self, response):
        self.response = response

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return None

    async def get(self, *args, **kwargs):
        return self.response


class ParserUtilityTests(unittest.TestCase):
    def test_extract_xhs_url_trims_chinese_punctuation(self):
        text = "去看 http://xhslink.com/o/abc123，进入【小红书】"

        self.assertEqual(parser.extract_xhs_url(text), "http://xhslink.com/o/abc123")

    def test_canonicalize_note_url_preserves_share_query_only(self):
        url = (
            "https://www.xiaohongshu.com/explore/note123?"
            "xsec_token=tok&share_id=share&unused=drop"
        )

        self.assertEqual(
            parser.canonicalize_note_url(url),
            "https://www.xiaohongshu.com/discovery/item/note123?xsec_token=tok&share_id=share",
        )

    def test_filter_detail_images_dedupes_to_dft_and_blocks_assets(self):
        prv = (
            "http://sns-webpic-qc.xhscdn.com/a/notes_uhdr/"
            "1040abc!nd_prv_wlteh_jpg_3"
        )
        dft = (
            "http://sns-webpic-qc.xhscdn.com/b/notes_uhdr/"
            "1040abc!nd_dft_wlteh_jpg_3"
        )
        static_asset = "https://fe-static.xhscdn.com/app.js"

        self.assertEqual(
            parser.filter_detail_images([prv, static_asset, dft], require_size=False),
            [dft],
        )

    def test_filter_detail_images_accepts_og_image_without_note_directory(self):
        image = (
            "http://sns-webpic-qc.xhscdn.com/hash/"
            "1040g2sg320kue1625ke05ppk2c273d7msicqaq0!nd_dft_wlteh_jpg_3"
        )

        self.assertEqual(parser.filter_detail_images([image], require_size=False), [image])


class ParserMediaTests(unittest.TestCase):
    def test_extract_note_media_pairs_live_photo_with_h264_master_url(self):
        image = (
            "http://sns-webpic-qc.xhscdn.com/a/notes_uhdr/"
            "1040abc!nd_dft_wlteh_jpg_3"
        )
        video = "http://sns-video-v6.xhscdn.com/stream/live.mp4?sign=1"
        note = {
            "imageList": [
                {
                    "urlDefault": image,
                    "livePhoto": True,
                    "stream": {"h264": [{"masterUrl": video, "backupUrls": []}]},
                }
            ]
        }

        images, live_photos = parser.extract_note_media(note)

        self.assertEqual(images, [image])
        self.assertEqual(live_photos, [{"image": image, "video": video}])

    def test_extract_video_urls_from_value_dedupes_nested_streams(self):
        video = "http://sns-video-v6.xhscdn.com/stream/video.mp4?sign=1"
        value = {"video": {"stream": {"h264": [{"masterUrl": video}, {"masterUrl": video}]}}}

        self.assertEqual(parser.extract_video_urls_from_value(value), [video])

    def test_pair_live_photos_does_not_create_video_without_matching_image(self):
        images = ["http://sns-webpic-qc.xhscdn.com/a/notes_uhdr/1040a!nd_dft_wlteh_jpg_3"]
        videos = ["http://sns-video-v6.xhscdn.com/1.mp4", "http://sns-video-v6.xhscdn.com/2.mp4"]

        self.assertEqual(
            parser.pair_live_photos(images, videos),
            [{"image": images[0], "video": videos[0]}],
        )


class StaticParseTests(unittest.IsolatedAsyncioTestCase):
    async def test_extract_static_note_detail_reads_initial_state_media(self):
        image = (
            "http://sns-webpic-qc.xhscdn.com/a/notes_uhdr/"
            "1040abc!nd_dft_wlteh_jpg_3"
        )
        live_video = "http://sns-video-v6.xhscdn.com/stream/live.mp4?sign=1"
        normal_video = "http://sns-video-v6.xhscdn.com/stream/normal.mp4?sign=2"
        html = f"""
        <script>window.__INITIAL_STATE__={{"note":{{"noteDetailMap":{{"note123":{{"note":{{
          "noteId":"note123",
          "title":"标题",
          "desc":"描述",
          "imageList":[{{"urlDefault":"{image}","livePhoto":true,
            "stream":{{"h264":[{{"masterUrl":"{live_video}","backupUrls":[]}}]}}}}],
          "video":{{"stream":{{"h264":[{{"masterUrl":"{normal_video}"}}]}}}}
        }}}}}}}}}}</script>
        """
        response = FakeResponse(text=html)

        with patch.object(parser.httpx, "AsyncClient", lambda *args, **kwargs: FakeAsyncClient(response)):
            detail = await parser.extract_static_note_detail(
                "https://www.xiaohongshu.com/discovery/item/note123"
            )

        self.assertEqual(detail["title"], "标题")
        self.assertEqual(detail["description"], "描述")
        self.assertEqual(detail["images"], [image])
        self.assertEqual(detail["live_photos"], [{"image": image, "video": live_video}])
        self.assertEqual(detail["videos"], [normal_video])


if __name__ == "__main__":
    unittest.main()
