# Telefon Portal

Əməkdaşların əlaqə məlumatları, struktur bölmələri, iclas otağı rezervasiyası və istifadəçi səlahiyyətlərinin idarə olunması üçün veb portal.

## Layihə Strukturu

```text
.
├── public/                 # Frontend statik fayllar
│   ├── css/
│   │   └── portal.css      # Portal və mobil responsiv üslublar
│   ├── js/
│   │   └── portal.js       # Frontend məntiqi, təqvim və konfiqurasiya
│   ├── logo/
│   │   └── Logo.png        # Portal loqosu
│   └── portal.html         # Əsas HTML interfeysi
├── src/                    # Backend mənbə kodları
│   ├── server.js           # Express + PostgreSQL REST API serveri
│   ├── auth.js             # Token əsaslı autentifikasiya və rol yoxlamaları
│   └── mailer.js           # İclas bildirişləri üçün e-poçt köməkçisi
├── db/                     # Verilənlər bazası faylları
│   ├── schema.sql          # Cədvəl sxemləri
│   ├── seed.sql            # İlkin məlumatlar
│   ├── portal_backup.sql   # Baza ehtiyat nüsxəsi
│   └── setup_db.js         # Baza quraşdırma skripti
├── .env.example            # Mühit dəyişənləri şablonu
├── .gitignore
├── package.json
└── README.md
```

## Quraşdırma

1. Asılılıqları quraşdırın:
   ```bash
   npm install
   ```
2. `.env.example` faylını `.env` olaraq kopyalayın və PostgreSQL məlumatlarını daxil edin:
   ```bash
   cp .env.example .env
   ```
3. Verilənlər bazasını quraşdırın (lazım olduqda):
   ```bash
   npm run setup-db
   ```
4. Serveri işə salın:
   ```bash
   npm start
   ```
