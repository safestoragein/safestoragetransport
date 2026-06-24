-- SafeStorage Transport — 02_seed_vendors.sql  (run AFTER 01_schema.sql)

insert into safestorage.vendors
  (city, name, vehicle_type, pallet_capacity, effective_capacity, tier,
   starting_point, starting_lat, starting_lng, daily_price, pricing_note, per_transaction, is_intercity_vendor,
   system_team_id, system_team_no, vehicle_no, vehicle_name, driver_name, driver_contact,
   supervisor_name, supervisor_contact, packer_names, team_working_status, source)
values
  ('Bangalore','VMS Packers Team 1','14ft',7,7.5,'general','Akshaya Nagar',12.897,77.633,7500,null,null,false,'158','VMS Packers Team','KA51AJ4776','VMS vehicle','Naveen vms','7676379728','Asif vms','9910484037',null,'Free','excel'),
  ('Bangalore','VMS Packers Team 2','14ft',7,7.5,'general','Akshaya Nagar',12.897,77.633,7500,null,null,false,'158','VMS Packers Team','KA51AJ4776','VMS vehicle','Naveen vms','7676379728','Asif vms','9910484037',null,'Free','excel'),
  ('Bangalore','Unnathi Packers','14ft',7,7.5,'general','Yeshwanthapur',13.028,77.54,7000,null,null,false,'161','Unnathi packers','KA27A7439','Unnati vehicle','Dayanand unnathi driver','9611570438','Sandeep','9611570438',null,'Free','excel'),
  ('Bangalore','Rainbow Packers','14ft',7,7.5,'general','Electronic City',12.845,77.66,7000,null,null,false,'127','BLR-Rainbow packers (Pankaj)','KA01D0258','Rainbow packers','Ajith','8757597451','Pankaj','8689083287','Anirul Ghazi','Free','excel'),
  ('Hyderabad','BRL Packers','14ft',7,7.5,'general','Chintal',17.508,78.452,7000,null,null,false,'174','BRL Packers (HYD)','TS08UJ8194','BRL Packers (HYD)','Vikas','9505655451','Anil','9050223525','Sahil, Smit','Free','excel'),
  ('Chennai','Kuberan Packers Team 1','14ft',7,7.5,'general','Ambattur',13.098,80.161,6200,null,null,false,'153','Kuberan Team 2','kuberan','Kuberan_drvier','kubera_driver','9789946011','Datchana','8610877228','Arpit','Free','excel'),
  ('Chennai','Kuberan Packers Team 2','14ft',7,7.5,'general','Gudapakkam',13.132,80.045,6200,null,null,false,'153','Kuberan Team 2','kuberan','Kuberan_drvier','kubera_driver','9789946011','Datchana','8610877228','Arpit','Free','excel'),
  ('Mumbai','BRL Packers','14ft',7,7.5,'general','Thane',19.218,72.978,7500,null,null,false,'207','BRL packers mum','KA 02 K 0050','BRL packers mum','BRL packers mumbai','9345234256','Pradeep','8800972698',null,'Free','excel'),
  ('Delhi','Rainbow Packers','14ft',7,7.5,'general','Dhanwapur',28.452,76.998,7000,null,null,false,'177','Delhi Jaykumar Rainbow team','rainbow vehicle','Delhi Vendor Rainbow team','Delhi Rainbow Driver','8088848484','Rajkumar','9899372676','Dilip proja','Free','excel'),
  ('Delhi','BRL Packers','14ft',7,7.5,'general','New Delhi',28.613,77.209,7000,null,null,false,'208','BRL packers delhi','ka 04 m 4697','brl packers delhi','BRL packers driver','8088848484','BRL packers delhi','9319546040',null,'Free','excel'),
  ('Bangalore','Chandan Packers','10ft',4,4.2,'general','Kasavanahalli',12.9,77.68,5000,null,null,false,'199','Chandan packers bangalore team','KA000','Chandan packers bangalore vehicle','Chandan Packers driver','8121345678','Chandan','9066519554',null,'Free','excel'),
  ('Bangalore','Rainbow Packers','10ft',4,4.2,'general','Electronic City',12.845,77.66,5000,null,null,false,'127','BLR-Rainbow packers (Pankaj)','KA01D0258','Rainbow packers','Ajith','8757597451','Pankaj','8689083287','Anirul Ghazi','Free','excel'),
  ('Bangalore','Unnathi Packers','10ft',4,4.2,'general','Yeshwanthapur',13.028,77.54,5000,null,null,false,'161','Unnathi packers','KA27A7439','Unnati vehicle','Dayanand unnathi driver','9611570438','Sandeep','9611570438',null,'Free','excel'),
  ('Bangalore','GSL Cargo Packers','10ft',4,4.2,'general','Rammurthy Nagar',13.018,77.677,5500,null,null,false,'188','GSL cargo packers','KA 02 K 0010','GSL packers','GSL cargo packers driver','9473768456','Kapil','9057731446',null,'Free','excel'),
  ('Hyderabad','Shree Shyam Packers','10ft',4,4.2,'general','Secunderabad',17.44,78.498,5000,null,null,false,'119','Shree shyam packers T1 (Arif Ali)','TS08UH9440','HYD_Eicher-E1','Maneesh Driver','8114780845','Arif Ali','7742632140','Panesh das, Rinku das','Free','excel'),
  ('Pune','BRL Packers','10ft',4,4.2,'general','Lonikand',18.602,73.989,4500,null,null,false,'176','BRL pune Mandeep','pune team','BRL Packers Pune (Mandeep)','Vendor Driver Pune BRL','8088848484','Mandeep','9728147180','Ayush','Free','excel'),
  ('Pune','SPM Packers','10ft',4,4.2,'general','Ngidi',18.651,73.77,6000,null,null,false,'184','SPM Team 1','SPM','SPM Drvier 1','SPM driver 1','8088848484','SPM Team1','9689433296','Nasim Akthar','Free','excel'),
  ('Mumbai','Sanjay Packers','10ft',4,4.2,'general','Chembur',19.062,72.9,5000,null,null,false,'203','Sanjay Packers','ka 04 m 4642','sanjay packers','Sanjay Packers driver','8980837464','Sanjay','7007924147',null,'Free','excel'),
  ('Bangalore','VMS Packers Team 3','others',7,7.5,'non_general','Akshaya Nagar',12.897,77.633,null,'6 transactions / ₹20,000',3333,false,'158','VMS Packers Team','KA51AJ4776','VMS vehicle','Naveen vms','7676379728','Asif vms','9910484037',null,'Free','excel'),
  ('Bangalore','Daksh Cargo Packers','others',7,7.5,'non_general','Kasavanahalli',12.9,77.68,null,'6 transactions / ₹15,000',2500,false,'183','Daksh packer Lakshman','Daksh','Daksh cargo packers','Daksh cargo packers','1233211231','Pappu Daksh cargo','9041634891','Sumir proja','Free','excel')
on conflict (city, name, vehicle_type) do nothing;
