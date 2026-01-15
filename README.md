# Supertonic 2 - TTS Service for Read Aloud

Lightning-fast, on-device, multilingual text-to-speech service powered by [Supertone Supertonic 2](https://huggingface.co/Supertone/supertonic-2).

## Features

- **10 Voices**: 5 male (M1-M5) + 5 female (F1-F5)
- **5 Languages**: English, Korean, Spanish, Portuguese, French
- **On-Device Processing**: Uses ONNX Runtime in the browser
- **No API Calls**: All processing happens locally

## Voices

| ID | Name | Gender | Description |
|----|------|--------|-------------|
| M1 | Alex | Male | Lively, upbeat with confident energy |
| M2 | James | Male | Deep, robust; calm and serious |
| M3 | Robert | Male | Polished, authoritative |
| M4 | Sam | Male | Soft, neutral-toned; gentle |
| M5 | Daniel | Male | Warm, soft-spoken; soothing |
| F1 | Sarah | Female | Calm with slightly low tone |
| F2 | Lily | Female | Bright, cheerful; lively |
| F3 | Jessica | Female | Clear, professional announcer-style |
| F4 | Olivia | Female | Crisp, confident; expressive |
| F5 | Emily | Female | Kind, gentle; soft-spoken |

## Technical Details

- Uses ONNX Runtime Web for inference
- Models loaded from HuggingFace CDN
- Sample rate: 24kHz
- Communicates with Read Aloud via postMessage

## License

- Sample code: MIT License
- Supertonic 2 model: OpenRAIL-M License

## Credits

- [Supertone Inc.](https://supertone.ai/) - Supertonic 2 TTS model
- [Read Aloud](https://github.com/nicedude11199/read-aloud) - Text-to-speech browser extension
