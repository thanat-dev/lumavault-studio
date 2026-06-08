# Private Media Downloader

Live static UI:

```text
https://thanat-dev.github.io/lumavault-studio/
```

Full Node + FFmpeg deployment guide:

```text
DEPLOY.md
```

โปรแกรมต้นแบบแบบ local-first สำหรับสกัดลิงก์ media จาก HTML/source ของหน้าที่ผู้ใช้มีสิทธิ์เข้าถึง แล้วดาวน์โหลดผ่านเครื่องของผู้ใช้เอง

## Run

```powershell
npm start
```

เปิดหน้าเว็บที่:

```text
http://localhost:4173
```

## Workflow

1. เปิดหน้าวิดีโอด้วยบัญชีที่มีสิทธิ์ดู
2. เปิด page source แล้วคัดลอก HTML/source
3. วาง URL หน้าเว็บและ source ลงในโปรแกรม
4. กด `Analyze`
5. เลือกรายการ media ที่พบ แล้วกด `Download`

## Scope

โปรเจกต์นี้ไม่ล็อกอินแทนผู้ใช้ ไม่เก็บ cookie/token และไม่ bypass privacy ของแพลตฟอร์ม ใช้สำหรับคอนเทนต์ที่ผู้ใช้เป็นเจ้าของหรือมีสิทธิ์เข้าถึงเท่านั้น

## Files

- `server.js` - local server, parser, and download proxy
- `public/index.html` - main UI
- `public/styles.css` - app styling
- `public/app.js` - browser-side interaction

## Render

Render uses `ffmpeg` from the local machine. If Render says FFmpeg is missing, run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install-ffmpeg.ps1
```

Then restart the app from the desktop icon.
