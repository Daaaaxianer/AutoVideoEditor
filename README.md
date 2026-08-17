# 🎬 AutoVideoEditor · 家庭视频自动剪辑工具

把手机里堆积的家庭照片和视频，一键变成**社交平台风格**的高质量成片。
自动完成：**选材 → 剪辑（运镜/转场/节奏）→ 滤镜 → 音乐 → 字体 → 字幕 → 导出**。
所有环节都可自定义，内置 **16 套模板 × 全风格变体**。

![platform](https://img.shields.io/badge/platform-Windows%20%7C%20Linux%20%7C%20macOS-blue)
![node](https://img.shields.io/badge/Node.js-%3E%3D18-brightgreen)
![ffmpeg](https://img.shields.io/badge/ffmpeg-required-ff6b6b)
![deps](https://img.shields.io/badge/npm%20deps-zero-orange)
![privacy](https://img.shields.io/badge/privacy-100%25%20local-3ddc84)
![license](https://img.shields.io/badge/license-MIT-yellow)

- **Windows 原生支持**：双击 `.bat` 即可启动；Linux/macOS 同样可跑
- **本地 CPU/GPU 渲染**：自动探测 Intel QSV / NVIDIA NVENC / AMD AMF / Windows MF 硬件编码，失败自动回退 CPU；**全程不上传任何数据**
- **零 npm 依赖**：只用 Node.js 内置模块 + 系统 ffmpeg
- **本地人脸识别**：YuNet ONNX 模型（OpenCV 后端），人脸优先选片、人脸保持画面位置
- **内置真实曲库**：19 首抖音/快手热门风格背景乐（CC-BY 4.0），也支持上传本机音乐
- **可选增强**：AI 文案（Ollama/API）、语音识别字幕（whisper/API），默认关闭、失败自动回退

## 📑 目录

- [一、Windows 一键运行](#一windows-一键运行)
- [二、Web 界面使用](#二web-界面使用)
- [三、命令行用法](#三命令行用法)
- [四、本地 CPU / GPU 渲染](#四本地-cpu--gpu-渲染)
- [五、可选 AI 增强](#五可选-ai-增强最后手段默认关闭)
- [六、内置模板与风格](#六内置模板与风格)
- [七、自定义进阶](#七自定义进阶)
- [八、工作原理](#八工作原理简)
- [九、技术原理与实现手段](#九技术原理与实现手段)
- [十、常见问题](#十常见问题)
- [十一、许可证](#十一许可证)

## 📸 界面预览

> 截图占位：上传一张整体界面截图（素材库 / 模板滑动列表 / 自定义面板 / 播放区）替换此说明。

```
┌──────────────────────────────────────────────────┐
│  🎬 AutoVideoEditor · 功能小字 · 特点色块 · 状态 · 数据条 │  ← 单一横幅栏
├──────────────┬──────────────┬──────────────────┤
│   素材库     │ 模板与风格   │   自定义 & 生成   │
│  (缩放/勾选) │ (纵向滑动)   │  (AI/引擎/生成)   │   ← 三栏等高
├──────────────┴──────────────┼──────────────────┤
│       ▶ 成片预览            │   最近成片        │   ← 与三栏同列宽
└─────────────────────────────┴──────────────────┘
```

---

## 一、Windows 一键运行

```bat
双击  启动Web界面.bat    ← 自动打开浏览器（端口占用自动切换）
双击  生成演示素材.bat   ← 生成演示素材 + 内置音乐库
```

或者命令行：

```bash
node web/server.js                 # Web 界面
node src/cli.js --input input --music music --output output --template family-moments
```

### 环境要求

| 依赖 | 说明 |
|---|---|
| Node.js ≥ 18 | 已内置（v24 实测） |
| ffmpeg / ffprobe | 需在 PATH；Windows 推荐 [gyan.dev full build](https://www.gyan.dev/ffmpeg/builds/)（含 xfade/zoompan/drawtext/acrossfade 及全部硬件编码器） |
| GPU（可选） | Intel QSV（Arc/核显）/ NVIDIA NVENC / AMD AMF，自动探测；无 GPU 自动用 CPU |
| Python + opencv-python（可选） | 仅"人脸识别"需要：`pip install opencv-python`；未安装时自动降级（选片/构图不受影响） |
| 字体 | Windows 自带雅黑/楷体/幼圆等；macOS/Linux 自动扫描系统字体 |

> 本机 PowerShell 默认禁止 `npm.ps1`，直接用 `node` 命令即可（项目零依赖，不需要 npm）。

---

## 二、Web 界面使用

顶部为**单一横幅栏**：品牌 AutoVideoEditor + 功能小字、六色特点块（本地运行 / GPU 加速 / 人脸识别 / 内置音乐 / 零依赖 / 隐私安全）、状态胶囊与实时数据条（照片/视频/音乐/模板/已生成/引擎/人脸）。

界面分三步 + 底部两栏：

1. **① 素材库** — 缩略图自动生成；**勾选 = 使用该素材**（默认全勾选，取消勾选即不使用，外观无任何异常样式）；**全选复选框**点击一次全选、再点一次取消（与最近成片一致，无动效）；照片/视频数量自动联动；**🗑 删除勾选 = 移除素材链接**（**不删除本地文件**）；「🔄 重新扫描」在面板头部；**拖拽上传**或点击「📤 上传素材」；面板头部**🔍 缩放滑杆**可放大/缩小缩略图预览（平滑过渡）。
2. **② 模板与风格** — 16 套场景模板以**纵向列表**展示（右侧滑动条上下浏览，紧凑卡片），每套风格变体**两列图标排版**（🎵/🌿/📰 平台风格图标），并自动附加**三大平台通用风格**：🎵 抖音风·卡点 / 🌿 社媒风·清新 / 📰 正式媒体·沉稳。
3. **③ 自定义 & 生成** — 标题、副标题、**结尾文字**、滤镜、运镜、转场、字体、画幅（模板默认/16:9/9:16/1:1/4:3/21:9）、**封面（随机默认/指定某一帧/本地图片）**、音乐情绪/**选择音乐（▶ 试听 + 📂 上传本机音乐）**、音量、水印、字幕、随机种子、人脸优先、人脸保持画面位置、转场缩放、**画质（4K/2K/1080P 默认/720P/480P）**、**渲染引擎（自动=NVENC→QSV→AMF→MF，点击查看说明）**；**AI 增强**与**语音识别字幕**面板；成片时长按素材自动估算、可手动修改。**三栏（素材库 / 模板与风格 / 自定义&生成）以「自定义 & 生成」实际内容为基准等高**。
4. **▶ 成片预览 + 最近成片** — 底部两栏与上方三栏**共享同一列宽**：成片预览宽度 = 素材库 + 模板与风格，最近成片宽度 = 自定义 & 生成。**成片预览**为 4:3 舞台，点击成片后**自动播放**，提供**下载成片 / 下载封面 / 打开目录 / 删除**；**最近成片**卡片带**居中半透明播放键**、**勾选**与**下载 / 目录 / 删除**三按钮，顶部**全选 / 批量下载 / 批量删除**，失败任务也可删除；删除会**彻底移除本地成片与封面**；🔍 缩放滑杆可缩放预览（仅影响内部预览，不影响栏宽）。

生成时实时显示五步进度（扫描分析 → 智能选片 → 生成片段 → 转场合成 → 导出封面）与日志，完成后在线预览、下载成片与封面。

> 端口自动检测：若 8088 被占用，会自动改用下一个可用端口并在终端显示实际地址。
> 素材目录为空时自动回退 `samples/input` 演示素材；上传文件后自动切换回 `input`。

---

## 三、命令行用法

```
node src/cli.js [选项]

基础:
  --input <目录>        素材目录（默认 ./input，子目录递归）
  --music <目录>        音乐目录（默认 ./music）
  --output <目录>       输出目录（默认 ./output）
  --template <id>       模板（--list-templates 查看）
  --variant <id>        模板风格变体
  --title <文案>        主标题
  --subtitle <文案>     副标题
  --end-text <文案>     结尾文字（成片最后出现）
  --cover <random|time:N|file:PATH>   封面：random=随机（默认）；time:N=指定第 N 秒；file:PATH=本地图片

选片与时长:
  --photos <数量> / --videos <数量>   数量（0=模板默认）
  --duration <秒>                     目标成片时长（0=模板自动）
  --photo-duration <秒>               每张照片停留秒数
  --exclude "a.jpg;b.mp4"             排除指定素材

风格:
  --filter <id|auto>    滤镜（--list-filters 查看）
  --motion <auto|zoom-in|zoom-out|pan-left|pan-right|pan-up|pan-down|subtle|none>
  --transition <名字>   转场（fade/dissolve/slideleft/circleopen/...）
  --font-style <modern|title|kaiti|round|serif|mono>
  --font <字体文件> / --aspect <16:9|9:16|1:1|4:3|21:9>

音乐与声音:
  --music-file <文件> / --music-mood <mood> / --music-volume <0-1>
  --keep-audio          保留素材原声（与音乐混合）   --no-keep-audio 纯音乐（默认）

本地 GPU/CPU 与人脸:
  --hw-enc <auto|qsv|nvenc|amf|mf|off>
                        auto=自动探测 GPU 硬件编码（默认，NVENC→QSV→AMF→MF），off=纯 CPU
  --quality <2160p|1440p|1080p|720p|480p>   输出画质（默认 1080p）
  --face-weight <0-1>   人脸优先权重（默认 0.6；0=不偏好人脸）
  --face-safe | --no-face-safe   人脸保持画面位置（默认开启）
  --transition-zoom     转场缩放：视频片段轻微推近
  --use-files "a.jpg;b.mp4"      手动精选：只使用指定素材（按顺序）

语音识别字幕（可选，默认关闭）:
  --asr <off|auto|api>  auto=探测本地 whisper；api=OpenAI 兼容 /audio/transcriptions
  --asr-model <模型>    api 模式模型名（默认 whisper-1）
  --asr-base-url <地址> api 兼容地址（默认 https://api.openai.com/v1）
  --asr-key <密钥>      api 模式必填

可选 AI 增强（最后手段，失败自动回退）:
  --ai <off|auto|ollama|api>   默认 off；auto=探测本地 Ollama；ollama=强制本地；api=在线
  --ai-model <模型名>          如 qwen2.5:7b / deepseek-chat
  --ai-base-url <地址>         API 兼容地址（默认 https://api.openai.com/v1）
  --ai-key <密钥>              API 模式必填

其它:
  --watermark <文案|off> / --no-captions / --seed <数字>
  --list-templates | --list-filters | --list-fonts
  -h, --help
```

示例：

```bash
# GPU 硬件编码 + 新年模板 · 鎏金风格 · 30 秒
node src/cli.js --template newyear --variant golden --title "新年快乐！" --duration 30

# 宝宝成长 · 拍立得 · 保留原声
node src/cli.js --template baby --variant polaroid --keep-audio

# 强制纯 CPU 编码
node src/cli.js --template wedding --hw-enc off

# 启用本地 Ollama AI（标题+选片增强；无 Ollama 时自动关闭）
node src/cli.js --template family-moments --ai auto --ai-model qwen2.5:7b

# 启用在线 API（OpenAI 兼容，如 DeepSeek/硅基流动）
node src/cli.js --template travel --ai api --ai-model deepseek-chat --ai-key sk-xxx --ai-base-url https://api.deepseek.com/v1

# 4K 画质 + 指定结尾文字 + 封面用第 5 秒画面
node src/cli.js --template wedding --quality 2160p --end-text "感谢观看" --cover time:5

# 封面使用本地图片
node src/cli.js --template family-moments --cover file:C:/Users/me/cover.png
```

---

## 四、本地 CPU / GPU 渲染

- **自动硬件编码**：启动时按 `NVIDIA NVENC → Intel QSV → AMD AMF → Windows MF` 顺序探测 GPU 编码器，探测通过即使用（成片日志会显示 `编码: Intel QSV (GPU)` 等）；某段编码失败自动回退 libx264（CPU），不影响出片。
- **纯 CPU**：`--hw-enc off` 或界面「纯 CPU」。
- **画质**：`--quality` 支持 4K(2160p)/2K(1440p)/1080p/720p/480p，按模板基准分辨率等比缩放。
- 素材分析与滤镜、运镜、转场、字幕等全部由本地 ffmpeg 完成，**不上传任何照片/视频**。

---

## 五、可选 AI 增强（最后手段，默认关闭）

启发式选片已覆盖质量/时间/多样性；AI 仅在需要更"懂内容"时使用：

| 模式 | 说明 |
|---|---|
| `off`（默认） | 完全不用 AI |
| `auto` | 自动探测本地 Ollama（127.0.0.1:11434），有则用、无则关 |
| `ollama` | 强制本地 Ollama，**数据不出本机** |
| `api` | OpenAI 兼容在线 API（需自备 Key，如 DeepSeek / 硅基流动 / OpenAI） |

AI 能力：
- **AI 标题**：根据模板情绪与素材时间跨度生成 主标题/副标题/结尾语（未手动填写时生效）
- **AI 选片**：把质量分前 30 的照片信息交给模型，按叙事顺序挑选并排序（结果异常时自动回退启发式）

Web 界面「🤖 可选 AI 增强」面板可配置并实时显示本地 Ollama 检测状态。

---

## 六、内置模板与风格

| 模板 id | 名称 | 画幅 | 风格变体 |
|---|---|---|---|
| `family-moments` | 家庭回忆录 | 9:16 | 日系清新 / 复古胶片 / 黑白怀旧 / 金色黄昏 |
| `birthday` | 生日派对 | 9:16 | 奶油甜暖 / 高饱和炫彩 / 梦幻柔光 |
| `travel` | 旅行日记 | 16:9 | 金色黄昏 / 电影感 / 森系淡雅 |
| `baby` | 宝宝成长 | 9:16 | 梦幻柔光 / 清新淡雅 / 拍立得 |
| `wedding` | 婚礼纪念 | 16:9 | 情绪暗调 / 复古胶片 / 黑白经典（银幕黑边） |
| `newyear` | 新年祝福 | 9:16 | 鎏金 / 复古贺岁 / 高饱和 |
| `pet` | 萌宠日常 | 1:1 | 奶油 / 活力 / 拍立得（默认保留原声） |
| `holiday` | 节日庆典 | 9:16 | 暖阳 / 冷调 / 清新 |
| `daily-vlog` | 生活Vlog | 16:9 | 电影感 / 暖阳 / 黑白文艺（默认保留原声） |
| `retro-family` | 复古家庭 | 1:1 | 旧照片 / 黑白 / 拍立得 |
| `autumn` | 秋日拾光 | 9:16 | 暖阳 / 森系 / 胶片 |
| `cinema-film` | 电影感大片 | 16:9 | 暗调情绪 / 黑白大片 / 金色史诗（银幕黑边） |
| `parent-child` | 亲子时光 | 9:16 | 梦幻柔光 / 粉彩甜酷 / 拍立得 |
| `graduation` | 毕业季 | 16:9 | 青春活力 / 电影感 / 金色黄昏 |
| `reunion` | 团圆饭 | 9:16 | 暖阳 / 老电影 / 复古胶片（默认保留原声） |
| `city-night` | 城市夜景 | 9:16 | 冷调 / 黑白高对比 / 情绪暗调 |

> 每个模板还会自动附加三大平台通用风格：🎵 抖音风·卡点（高饱和+欢快卡点音乐）、🌿 社媒风·清新（日系清新）、📰 正式媒体·沉稳（低饱和+舒缓）。

滤镜库（20 种 + auto + none）：`cinema` 电影青橙 · `fresh` 日系清新 · `retro` 复古胶片 · `bw` 黑白 · `warm` 暖阳 · `cool` 冷调 · `vivid` 活力高饱和 · `soft` 梦幻柔光 · `golden` 金色黄昏 · `moody` 情绪暗调 · `nostalgia` 旧照片 · `polaroid` 拍立得 · `forest` 森系 · `cream` 奶油甜暖 · `formal` 正式沉稳 · `cyber` 赛博霓虹 · `pastel` 粉彩甜酷 · `oldfilm` 老电影 · `bwhard` 黑白高对比。

---

## 七、自定义进阶

### 全局配置 `config.json`

```json
{
  "inputDir": "input",
  "musicDir": "music",
  "outputDir": "output",
  "template": "family-moments",
  "webPort": 8088,
  "hwEnc": "auto",
  "ai": { "mode": "off", "baseUrl": "", "apiKey": "", "model": "" },
  "seed": 0
}
```

### 新增模板

在 `templates/` 复制任意模板改字段即可（`id`/`name`/`text`/`filter`/`selection`/`variants`…）：

```jsonc
{
  "id": "my-template",
  "name": "我的模板",
  "aspect": "9:16",            // 9:16 | 1:1 | 16:9
  "mood": "warm",              // 情绪：用于 auto 滤镜与音乐匹配
  "transition": "fade",
  "transitionDuration": 0.6,
  "filter": "auto",            // auto | none | 滤镜 id
  "motion": "auto",
  "selection": { "photos": 10, "videos": 3, "minScore": 25 },
  "photoDuration": 2.6,
  "videoDuration": { "min": 2, "max": 4, "target": 3 },
  "music": { "mood": "warm", "volume": 0.32 },
  "keepAudio": false,
  "text": {
    "title": "默认标题", "subtitle": "默认副标题", "watermark": "水印",
    "titleDuration": 3.5, "endDuration": 3, "showDateLabels": true,
    "titleStyle":   { "fontStyle": "title", "color": "#FFF7E6", "size": 0.1, "y": 0.32 },
    "subtitleStyle":{ "fontStyle": "kaiti",  "color": "#FFD9A0", "size": 0.05, "y": 0.46 },
    "captionStyle": { "fontStyle": "modern", "color": "#FFFFFF", "size": 0.038, "y": 0.88 },
    "endText": "结尾语"
  },
  "endCard": { "bg": "#2B1F3D", "bg2": "#12101F" },
  "variants": [
    { "id": "default", "name": "默认", "filter": "auto", "musicMood": "", "fontStyle": "auto" }
  ]
}
```

### 新增滤镜 / 字体风格

- 滤镜：编辑 `src/filters.js` 的 `PRESETS`（值是 ffmpeg 滤镜串）。
- 字体风格：编辑 `src/textstyle.js` 的 `STYLE_FONTS`（按系统字体文件名匹配）。

---

## 八、工作原理（简）

```
素材目录 ──扫描分类──> 照片/视频 ──质量分析──> 亮度/对比度/饱和度/清晰度/平均色
    │                                                       │
    │        ┌── 打分(质量分+画幅匹配) ──┐                   │
    └── 选片 <── MMR 贪心(色彩多样性)   │ <───────────────────┘
              └── 时间覆盖(按天分组)    │        ┌─(可选) AI 排序/文案 ─┐
                                      ▼        └──────────────────────┘
  模板 JSON ──> 时间轴(标题卡+素材+结尾卡, 转场重叠)
                                      │
  每段预处理: 照片=Ken Burns 运镜(zoompan)+滤镜
              视频=cover裁剪+滤镜(可选轻运镜)   ← GPU(QSV/NVENC/AMF) 或 CPU 编码
                                      │
  合成: xfade 链式转场 → drawtext(水印/日期字幕)
  音频: 音乐(mood 匹配, 循环+淡入淡出) + 可选素材原声(acrossfade 混合)
                                      │
              导出 mp4(H.264+AAC, faststart) + 封面 jpg
```

- **选片**：质量分过滤模糊/过暗 → 按天分组保证时间覆盖 → MMR 贪心（质量 + 色彩差异度 + 画幅匹配 + **人脸加分**）+ 近重复抑制。
- **人脸识别（本地）**：Python + OpenCV FaceDetectorYN 加载本地 YuNet ONNX 模型；有脸照片优先选中，裁剪/运镜自动以人脸为中心（人脸保持画面合适位置）；未装 Python 时自动关闭该能力。
- **自动音乐**：mood 关键词匹配文件名 + 时长匹配；**内置真实曲库**（`node samples/download_music.js` 下载抖音/快手热门风格背景乐，Kevin MacLeod CC-BY 4.0，见 `music/版权说明.txt`）；另有 10 首本地合成占位曲（`make_music.js`）；也可**上传本机音乐**（界面「📂 本地」）或 `--music-file` 指定；无音乐时生成氛围垫底音轨。
- **语音字幕（可选）**：视频片段语音转写为字幕（本地 whisper 或在线 API），失败自动跳过。
- **自动字体**：按风格扫描系统字体自动选择，中文优先。
- **本地优先**：全部计算在本地 CPU/GPU 完成；AI 仅按需启用且失败自动回退。

---

## 九、技术原理与实现手段

### 总体架构
- **语言/运行时**：Node.js（零 npm 依赖）+ 系统 ffmpeg/ffprobe；Windows 推荐 gyan.dev 全功能构建。
- **Web 端**：零依赖 `http` 模块实现静态服务与 REST API（素材/上传/渲染任务/成片操作），页面为原生 HTML/CSS/JS，无框架、无构建。
- **渲染任务**：Web 端提交参数后由服务器 `spawn` 子进程运行 CLI，日志写入文件供前端轮询进度（扫描分析 → 智能选片 → 生成片段 → 转场合成 → 导出封面）。

### 素材分析（本地）
- **质量特征**：ffmpeg 取 96×96 缩略帧，`signalstats` 提取亮度/对比度/饱和度，`edgedetect` 后再次取亮度作为边缘清晰度；`scale=1:1,format=rgb24` 读平均色用于去重与多样性。
- **人脸识别（本地 ONNX）**：`tools/face_detect.py` 用 Python + OpenCV `FaceDetectorYN` 加载本地 YuNet ONNX 模型（~230KB），批量返回人脸矩形；解决 Windows 中文路径（`np.fromfile+imdecode`、模型复制到 ASCII 临时目录）；未装 Python 时自动降级。

### 自动选片
质量分（亮度适中/对比度/清晰度/分辨率，+人脸加权）过滤模糊过暗 → 按天分组保证时间覆盖 → **MMR 贪心**（质量 + 与已选集合的最小色彩距离 + 画幅匹配 + 近重复抑制）。

### 渲染管线（ffmpeg filter graph）
- **时间轴**：标题卡 + 素材片段 + 结尾卡，按转场时长重叠；片段时长可整体缩放以满足目标成片时长。
- **照片动效**：`zoompan` Ken Burns（推/拉/平移），有脸照片以人脸为中心取景（安全区钳制）。
- **转场**：`xfade` 链式拼接（28 种），偏移量按累计时长 - 转场次数计算；转场缩放选项为视频片段加轻微推近。
- **字幕/水印**：`drawtext`（中文自动选字体，`expansion=none` + 转义），按时间窗 `enable` 显示日期或语音字幕。
- **音频**：音乐 `-stream_loop` 循环 + `atrim` + 淡入淡出；素材原声用 `acrossfade`（或 concat）链式混合，`amix` 与音乐混音（`normalize=0` 保留音量）。
- **编码**：硬件编码探测（Intel QSV → NVIDIA NVENC → AMD AMF → Windows MF），失败自动回退 libx264（CPU）；输出 `-movflags +faststart`，并生成封面 JPG。

### 模板系统
JSON 定义画幅/情绪/转场/滤镜/运镜/选片数量/文案/字体/音乐/风格变体；加载时自动附加三大平台风格变体（抖音风·卡点 / 社媒风·清新 / 正式媒体·沉稳），实现"模板 × 风格"矩阵；滤镜为 ffmpeg 滤镜串（curves/colorbalance/eq/vignette/noise 等组合），特效如银幕黑边用 `drawbox`。

### 音乐匹配
mood 关键词（文件名）+ 时长匹配 + 内置真实曲库优先（"内置_"前缀）；支持上传本机音乐、`--music-file` 指定；无音乐时用 `aevalsrc` 生成氛围垫底音轨。

### 可选增强（最后手段）
- **AI**：本地 Ollama 或 OpenAI 兼容 API，生成标题/优化选片，任何失败回退启发式。
- **语音字幕 ASR**：本地 whisper CLI 或在线 `/audio/transcriptions`（multipart），逐段转写为字幕。

### 目录结构要点
```
src/       核心管线（cli/scanner/probe/analyze/selector/filters/motion/textstyle/music/
           template/render/hwenc/face/asr/ai/config/utils）
web/       Web 服务与界面（server.js + index.html/app.js/style.css）
templates/ 16 套模板 JSON（含风格变体）
samples/   演示素材、合成音乐、真实曲库下载脚本
models/    人脸检测 ONNX 模型（YuNet）
tools/     Python 人脸检测助手（face_detect.py）
music/     内置音乐库（内置_* 为真实曲目；版权见 版权说明.txt）
```

---

## 十、常见问题

| 问题 | 解决 |
|---|---|
| HEIC/HEIF 照片无法读取 | 用系统「照片」批量导出 JPG，或安装带 libheif 的 ffmpeg |
| 硬件编码没有生效 | 运行 `ffmpeg -encoders` 确认有 h264_qsv/nvenc/amf；独显机型请确认驱动；或 `--hw-enc off` 用 CPU |
| 成片太短/太长 | `--duration` 指定，或调 `--photos`/`--videos`/`--photo-duration` |
| 音乐没自动选中 | 音乐文件名加情绪词（如 `happy_周末.m4a`），或 `--music-file` 指定 |
| AI 没有生效 | 默认关闭：`--ai auto` 需先启动本地 Ollama；`--ai api` 需配置 Key；任何失败自动回退 |
| 渲染慢 | 与素材数量/分辨率相关；可减小数量、用 GPU 编码、或降低素材分辨率 |
| 版权提示 | 请使用自有/授权背景音乐；本工具纯本地，不上传素材 |

---

## 十一、许可证

本项目基于 [MIT License](./LICENSE) 开源。

- 内置背景音乐：Kevin MacLeod (incompetech.com) — [CC-BY 4.0](https://creativecommons.org/licenses/by/4.0/)，需署名（详见 `music/版权说明.txt`）。
- 人脸检测模型：OpenCV Zoo YuNet（Apache-2.0，来源 [opencv_zoo](https://github.com/opencv/opencv_zoo)）。
- 请自行确认所使用素材（照片/视频/音乐）的授权与肖像权。

**说明**：本工具完全本地运行，不收集、不上传任何个人数据；欢迎 Star ⭐ 与 Issue 反馈。
