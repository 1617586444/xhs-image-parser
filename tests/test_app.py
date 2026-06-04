import unittest
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

import app as app_module


class AppRouteTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app_module.app)

    def test_index_contains_download_and_video_controls(self):
        response = self.client.get("/")

        self.assertEqual(response.status_code, 200)
        self.assertIn("/api/download-image", response.text)
        self.assertIn("/api/download-video", response.text)
        self.assertIn("下载视频", response.text)

    def test_parse_endpoint_returns_media_payload(self):
        payload = {
            "source_url": "https://www.xiaohongshu.com/discovery/item/note123",
            "note_id": "note123",
            "title": "标题",
            "description": "描述",
            "images": ["http://sns-webpic-qc.xhscdn.com/a/notes_uhdr/1040a!nd_dft_wlteh_jpg_3"],
            "live_photos": [
                {
                    "image": "http://sns-webpic-qc.xhscdn.com/a/notes_uhdr/1040a!nd_dft_wlteh_jpg_3",
                    "video": "http://sns-video-v6.xhscdn.com/stream/live.mp4",
                }
            ],
            "videos": ["http://sns-video-v6.xhscdn.com/stream/video.mp4"],
        }

        with patch.object(app_module, "parse_note_from_text", AsyncMock(return_value=payload)):
            response = self.client.get("/api/parse", params={"text": "http://xhslink.com/o/test"})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), payload)

    def test_parse_endpoint_wraps_parser_errors(self):
        with patch.object(
            app_module,
            "parse_note_from_text",
            AsyncMock(side_effect=ValueError("没有从输入中识别到小红书文章链接。")),
        ):
            response = self.client.get("/api/parse", params={"text": "bad"})

        self.assertEqual(response.status_code, 500)
        self.assertEqual(response.json()["detail"], "没有从输入中识别到小红书文章链接。")


if __name__ == "__main__":
    unittest.main()
