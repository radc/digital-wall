# Digital Wall (React + Express)

This project is a **digital wall / kiosk app** built with **Create React App** and a small **Express.js backend**.  
It displays photos and videos in fullscreen, with configuration options (image duration, fit mode, schedules, etc.) defined in a `media.json` file.  
It also includes an **Admin panel** (`/admin`) where you can upload, delete, and configure media files remotely (login required).

---

## Features

- 🎥 **Videos** play in full until the end.  
- 🖼 **Images** are shown for a configurable duration (default: 10s).  
- 🖌 Supports multiple **fit modes**: `fit`, `crop`, `fill`, `zoom`.  
- ⏰ **Schedule support**: each media can have start/end times and days of the week.  
- 🔄 Automatic **reload** of the media manifest every 60 seconds.  
- 💻 **Admin Panel** (`/admin`) with authentication:
  - Default login: **admin** / **1234**.
  - Upload new media (video/images).
  - Delete existing media.
  - Edit global defaults.
  - Add/remove overrides for individual files.
- 🛑 If no media is available, a clear message is displayed:  
  > *"Nenhuma mídia disponível no momento"* ("No media available at the moment").

---

## Project Structure

