#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
本地人脸检测（OpenCV FaceDetectorYN + YuNet ONNX 模型，数据不出本机）。
由 Node 端以子进程方式调用：stdin 输入 JSON，stdout 输出 JSON。
输入: {"model": "路径", "threshold": 0.6, "nms": 0.3, "files": ["a.jpg", ...]}
输出: {"faces": {"a.jpg": [{"x":..,"y":..,"w":..,"h":..}, ...]}, "ok": true}
任何异常返回 {"ok": false, "error": "..."}。
"""
import json
import sys
import os

# 保证中文路径在 Windows 下以 UTF-8 读写
if sys.version_info >= (3, 7):
    try:
        sys.stdin.reconfigure(encoding="utf-8")
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass


def main():
    try:
        import cv2
        import numpy as np
    except Exception as e:
        print(json.dumps({"ok": False, "error": "no-cv2: %s" % e}))
        return

    try:
        req = json.load(sys.stdin)
    except Exception as e:
        print(json.dumps({"ok": False, "error": "bad-input: %s" % e}))
        return

    model = req.get("model", "")
    threshold = float(req.get("threshold", 0.6))
    nms = float(req.get("nms", 0.3))
    files = req.get("files", [])
    if not os.path.exists(model):
        print(json.dumps({"ok": False, "error": "no-model: %s" % model}))
        return

    out = {"faces": {}, "ok": True, "error": ""}
    try:
        import tempfile
        import shutil
        # OpenCV 无法读取含中文的路径：把模型复制到 ASCII 临时目录再加载
        tmp_model = os.path.join(tempfile.gettempdir(), "aved_face_det.onnx")
        if not os.path.exists(tmp_model) or os.path.getsize(tmp_model) != os.path.getsize(model):
            shutil.copyfile(model, tmp_model)
        det = cv2.FaceDetectorYN.create(tmp_model, "", (320, 320), threshold, nms, 5000)
        for f in files:
            # 图片：np.fromfile 支持中文路径，imdecode 解码
            buf = np.fromfile(f, dtype=np.uint8)
            img = cv2.imdecode(buf, cv2.IMREAD_COLOR)
            if img is None:
                out["faces"][f] = []
                continue
            det.setInputSize((img.shape[1], img.shape[0]))
            _, faces = det.detect(img)
            rects = []
            if faces is not None:
                for row in faces:
                    x, y, w, h = float(row[0]), float(row[1]), float(row[2]), float(row[3])
                    rects.append({"x": x, "y": y, "w": w, "h": h})
            out["faces"][f] = rects
    except Exception as e:
        out["ok"] = False
        out["error"] = "detect-fail: %s" % e

    print(json.dumps(out, ensure_ascii=False))


if __name__ == "__main__":
    main()
