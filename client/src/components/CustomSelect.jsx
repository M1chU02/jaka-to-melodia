import { useState, useRef, useEffect } from "react";

export default function CustomSelect({ options, value, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef();

  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, []);

  const selected = options.find((o) => o.value === value);

  return (
    <div className="custom-select" ref={ref}>
      <button
        type="button"
        className="custom-select-btn"
        onClick={() => setOpen(!open)}>
        {selected?.label}
        <span className={`arrow ${open ? "up" : "down"}`} />
      </button>
      {open && (
        <ul className="custom-select-list">
          {options.map((o) => (
            <li
              key={o.value}
              className={`custom-select-item ${
                o.value === value ? "active" : ""
              }`}
              onClick={() => {
                onChange(o.value);
                setOpen(false);
              }}>
              {o.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
