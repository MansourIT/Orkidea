-- Orkidea CRA — code court des activités (DEV, REU, CP…), affiché dans le calendrier.
-- NULL pour les activités existantes : le code est alors déduit du libellé (shared/activity-code.ts).
ALTER TABLE activities ADD COLUMN code TEXT CHECK (code IS NULL OR (length(code) BETWEEN 1 AND 5 AND code = upper(code)));

UPDATE activities SET code = 'CP' WHERE id = 'abs-cp';
UPDATE activities SET code = 'RTT' WHERE id = 'abs-rtt';
UPDATE activities SET code = 'MAL' WHERE id = 'abs-maladie';
UPDATE activities SET code = 'ABS' WHERE id = 'abs-autre';
