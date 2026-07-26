-- Editorial pass #02 — Tier-2 site cleanup and specimen quote attachment
-- Applied: 2026-07-26

BEGIN;

-- Sima de los Huesos site: parser used the id string as the name. Fix, and add coords precision.
UPDATE sites SET
    name = 'Sima de los Huesos',
    region = 'Sierra de Atapuerca, Burgos Province',
    coordinates_precision = '10km',
    site_type = 'karst shaft (vertical bone-accumulation pit)',
    excavating_institution = 'Centro UCM-ISCIII de Evolución y Comportamiento Humanos, Madrid',
    verification_state = 'pending-verification'
WHERE id = 'sima-de-los-huesos';

-- Vindija Cave: same fixes.
UPDATE sites SET
    name = 'Vindija Cave',
    region = 'Hrvatsko Zagorje, Krapina-Zagorje County (northern Croatia)',
    coordinates_precision = '1km',
    site_type = 'karstic cave',
    verification_state = 'pending-verification'
WHERE id = 'vindija-cave';

-- Attach source-locked quotes for the Tier-2 specimens
UPDATE specimens SET
    taxonomic_assignment_source_quote = 'Here we recover nuclear DNA sequences from two specimens, which show that the Sima de los Huesos hominins were related to Neanderthals rather than to Denisovans, indicating that the population divergence between Neanderthals and Denisovans predates 430,000 years ago.',
    verification_state = 'pending-verification',
    verification_notes = 'Editorial pass 2026-07-26: source-locked quote from Meyer 2016 abstract attached. Femur specimen catalog number requires Methods/SI extraction to confirm whether this is the same Femur XIII specimen as Meyer 2014 (mtDNA) or a distinct individual.'
WHERE id = 'sima-femur-xiii';

UPDATE specimens SET
    taxonomic_assignment_source_quote = 'Here we recover nuclear DNA sequences from two specimens, which show that the Sima de los Huesos hominins were related to Neanderthals rather than to Denisovans, indicating that the population divergence between Neanderthals and Denisovans predates 430,000 years ago.',
    verification_state = 'pending-verification',
    verification_notes = 'Editorial pass 2026-07-26: source-locked quote from Meyer 2016 abstract attached. Incisor specimen catalog number requires Methods/SI extraction. Note: the mtDNA result on this specimen clusters with Denisovans (discordant with nuclear assignment) — recorded on the mtDNA analysis row.'
WHERE id = 'sima-incisor';

UPDATE specimens SET
    taxonomic_assignment_source_quote = 'We sequenced the genome of a female Neandertal from ~50 thousand years ago from Vindija Cave, Croatia to ~30-fold genomic coverage.',
    verification_state = 'pending-verification',
    verification_notes = 'Editorial pass 2026-07-26: source-locked quote from Prüfer 2017 abstract attached. Vindija 33.19 is the second-published high-coverage Neanderthal genome (after Denisova 5 / Altai) and the first from a western-Eurasian site.'
WHERE id = 'vindija-33-19';

COMMIT;
