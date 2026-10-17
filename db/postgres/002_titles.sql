UPDATE sessions SET title = replace(title, ' · ', ', ') WHERE title LIKE '% · %';
