-- First admin: put your email here BEFORE signing in the first time.
insert into invitations (email, name, role) values ('admin@example.com', 'Admin', 'admin')
on conflict do nothing;

insert into tracks (id, name, sponsor) values
  ('A', 'Track A', null), ('B', 'Track B', null), ('C', 'Track C', null), ('D', 'Track D', 'IBM');

-- PLACEHOLDERS: replace with text from Hackurity_2026_Problem_Statements_Final_2.docx
-- (editable later in Admin > Problem statements).
insert into problem_statements (id, track_id, title, difficulty, brief, core, stretch) values
  (1,'A','PS-1 (replace title)','Medium','Replace with brief.', array['Core deliverable 1','Core deliverable 2'], array['Stretch 1','Stretch 2','Stretch 3']),
  (2,'A','PS-2 (replace title)','Hard','Replace with brief.', array['Core deliverable 1','Core deliverable 2'], array['Stretch 1','Stretch 2','Stretch 3']),
  (3,'B','PS-3 (replace title)','Medium','Replace with brief.', array['Core deliverable 1','Core deliverable 2'], array['Stretch 1','Stretch 2','Stretch 3']),
  (4,'B','PS-4 (replace title)','Hard','Replace with brief.', array['Core deliverable 1','Core deliverable 2'], array['Stretch 1','Stretch 2','Stretch 3']),
  (5,'C','PS-5 (replace title)','Medium','Replace with brief.', array['Core deliverable 1','Core deliverable 2'], array['Stretch 1','Stretch 2','Stretch 3']),
  (6,'C','PS-6 (replace title)','Hard','Replace with brief.', array['Core deliverable 1','Core deliverable 2'], array['Stretch 1','Stretch 2','Stretch 3']),
  (7,'D','PS-7 (replace title)','Medium','Replace with brief.', array['Core deliverable 1','Core deliverable 2'], array['Stretch 1','Stretch 2','Stretch 3']),
  (8,'D','PS-8 (replace title)','Hard','Replace with brief.', array['Core deliverable 1','Core deliverable 2'], array['Stretch 1','Stretch 2','Stretch 3']);
