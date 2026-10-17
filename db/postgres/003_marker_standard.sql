INSERT INTO reference_standards (owner_id,name,kind,width_mm,height_mm,tolerance_mm,note)
SELECT NULL,'Квадратный маркер 50 × 50 мм','custom',50,50,0.5,'Тёмный квадрат с белым рисунком на картоне; ищется автоматически'
WHERE NOT EXISTS (SELECT 1 FROM reference_standards WHERE owner_id IS NULL AND name='Квадратный маркер 50 × 50 мм');
